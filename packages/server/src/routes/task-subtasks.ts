import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getProject } from "../db.js";
import { getAppSettings } from "../app-settings.js";
import { bumpManagerMetric, getManagerMetrics } from "../manager-metrics.js";
import { addManagerQuestion } from "../manager-tick.js";
import { serverLog } from "../log-bus.js";
import { readDocFile } from "../docs-service.js";
import { runVerify } from "../issue-verify.js";
import {
  parseSubtasksFromPlan,
  type ParseSubtasksResult,
  type SubtaskGraph,
  type SubtaskSpec,
  topologicalWaves,
} from "../task-subtasks.js";
import {
  deleteSubtaskMeta,
  loadSubtaskOrphans,
  subtaskRuns,
  writeSubtaskMeta,
  type SubtaskRun,
  type SubtaskRunState,
} from "../task-subtasks-store.js";
import {
  JOB_ANSWER_REL_PATH,
  JOB_ASK_REL_PATH,
  JOB_SIGNAL_REL_PATH,
  spawnWorktreeJob,
  type WorktreeJobAgent,
  type WorktreeJobSpawnInfo,
} from "../worktree-session-runner.js";
import { appendStatusEntry } from "../task-status.js";
import { broadcast } from "../ws-hub.js";
import { existsSync } from "node:fs";

const MAX_CONCURRENCY = 5;

const DispatchSchema = z.object({
  agent: z.enum(["claude", "codex", "shell"]).optional(),
  maxConcurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
  /** 任务图确认凭证。managerConfirmGraph 开时必填,且必须与当前任务图 hash 匹配。 */
  confirmToken: z.string().optional(),
});

/**
 * 派工前确认凭证。`managerConfirmGraph` 开时,dispatch 必须带一个由
 * `prepare-dispatch` 发放、且绑定**当前任务图内容 hash** 的 token。用户在 UI
 * 改了任务图(hash 变)→ 旧 token 对不上 → 作废,杜绝"确认 A 图却派 B 图"。
 * 进程内存即可(会话级确认,server 重启需重新确认是合理预期)。
 */
const dispatchTokens = new Map<string, { graphHash: string; token: string }>();

/**
 * N3.3 预算熔断:同一子任务被反复重派的次数上限。失败的子任务允许重派(修了再跑),
 * 但反复失败重派会烧 token、可能死循环。超过这个数就硬停,要人介入。
 * (对齐 CLAUDE.md"同一步骤连续失败 2–3 次就停手"的熔断精神。)
 */
const MAX_REDISPATCH = 3;
const redispatchCounts = new Map<string, number>();

function tokenKey(projectId: string, taskName: string): string {
  return `${projectId}::${taskName}`;
}

/** 任务图内容指纹:只取决定"派什么活"的字段,与展示无关的顺序无关。 */
function computeGraphHash(graph: SubtaskGraph): string {
  const norm = [...graph.subtasks]
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      title: s.title,
      write_files: [...s.write_files].sort(),
      depends_on: [...s.depends_on].sort((x, y) => x - y),
      danger: s.danger ? [...s.danger].sort() : [],
    }));
  return createHash("sha1").update(JSON.stringify(norm)).digest("hex");
}

interface GitCmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(cwd: string, args: string[]): Promise<GitCmdResult> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => (stdout += c.toString("utf8")));
    proc.stderr?.on("data", (c) => (stderr += c.toString("utf8")));
    proc.on("error", (err) => {
      stderr += `\n[spawn error] ${err.message}`;
    });
    proc.on("exit", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

/**
 * 危险动作硬检测:按子任务在它 worktree 分支上**实际改了什么**判断,不信经理 AI
 * 自报的 danger 字段。比对基准 = 该分支与项目基分支的 merge-base(分叉点),这样
 * 只看本子任务自己的改动,不受其它已合并子任务干扰。
 *
 * **fail-closed**:任何 git 命令失败 / 拿不到分叉点 → `error=true`,调用方按"命中
 * 危险"处理(宁可错拦不可放过)。
 */
interface DangerScan {
  error: boolean;
  deletes: string[];
  dbTouch: string[];
}

const DB_PATH_RE = /(^|\/)(db\.ts|.*\.(db|sqlite|sqlite3)(-journal|-wal|-shm)?|.*\.sql)$|(^|\/)(migrations?|migrate)\//i;
const DB_DDL_RE = /^\+.*\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|DROP\s+COLUMN|ADD\s+COLUMN|CREATE\s+INDEX)\b/im;

export async function scanDangerousChanges(
  worktreePath: string,
  projectPath: string,
): Promise<DangerScan> {
  const baseRef = await runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!baseRef.ok) return { error: true, deletes: [], dbTouch: [] };
  const base = baseRef.stdout.trim() || "HEAD";
  const mb = await runGit(worktreePath, ["merge-base", base, "HEAD"]);
  if (!mb.ok) return { error: true, deletes: [], dbTouch: [] };
  const forkPoint = mb.stdout.trim();
  if (!forkPoint) return { error: true, deletes: [], dbTouch: [] };

  // --name-status 比对分叉点 → worktree 当前(含未提交改动)。D 行 = 删除。
  const nameStatus = await runGit(worktreePath, ["diff", "--name-status", forkPoint]);
  if (!nameStatus.ok) return { error: true, deletes: [], dbTouch: [] };
  const deletes: string[] = [];
  const dbTouch: string[] = [];
  for (const line of nameStatus.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [status, ...rest] = trimmed.split(/\t/);
    const path = rest.join("\t");
    if (!path) continue;
    if (status.startsWith("D")) deletes.push(path);
    if (DB_PATH_RE.test(path)) dbTouch.push(path);
  }
  // 内容扫一遍 SQL DDL(只看新增行),抓"改 db.ts 加表/列"这种路径名兜不住的。
  const content = await runGit(worktreePath, ["diff", "-U0", forkPoint]);
  if (!content.ok) return { error: true, deletes, dbTouch };
  if (DB_DDL_RE.test(content.stdout) && dbTouch.length === 0) {
    dbTouch.push("(diff 内含建表/改表 SQL)");
  }
  return { error: false, deletes, dbTouch };
}

function buildSubtaskPrompt(opts: {
  taskName: string;
  spec: SubtaskSpec;
  planExcerpt: string;
  doneSubtasks: number[];
}): string {
  const fileLines = opts.spec.write_files.map((f) => `  - ${f}`).join("\n");
  const depLine =
    opts.spec.depends_on.length === 0
      ? "（无依赖）"
      : opts.spec.depends_on.join(", ");
  const doneLine =
    opts.doneSubtasks.length === 0
      ? "（首批子任务，所有上游尚未开始）"
      : opts.doneSubtasks.join(", ");
  return `你被派去执行主任务「${opts.taskName}」的子任务 #${opts.spec.id}：${opts.spec.title}。

## 你的边界
- **只允许修改这些文件**（write_files）：
${fileLines}
- 依赖的上游子任务：${depLine}
- 已经 merged 的上游子任务（最新主分支已含其改动）：${doneLine}
- 不要走 plan/context/tasks 三段式，主任务的 plan/context/tasks 已经定好，你只看自己这一步。
- 严守"外科式改动"——只动 write_files 内的文件，看到无关代码不要顺手优化。

## 主任务 plan 摘要
${opts.planExcerpt}

## 遇到拿不准时：问经理（不要瞎猜）
- 卡在歧义（接口要哪种、目标不明确、边界拿不准）时，把问题写进 worktree 内文件 \`${JOB_ASK_REL_PATH}\`（一行），然后**轮询** \`${JOB_ANSWER_REL_PATH}\` 直到出现经理的答复再继续。
- 另外每完成一个小阶段，**瞄一眼** \`${JOB_ANSWER_REL_PATH}\`：经理可能主动写了纠偏/追加约束，有就照办。
- 这是带外文件通信，不要在终端里喊话。

## 完成约定
- 完成后把完成信号写入 worktree 内文件 \`${JOB_SIGNAL_REL_PATH}\`（目录不存在就创建），内容只写一行：
  DONE
- 无法完成（连续 2-3 次失败、范围超出 write_files）把信号文件 \`${JOB_SIGNAL_REL_PATH}\` 写成一行：
  STUCK: <一句话原因>
- 写完信号文件后等待 verify pipeline 接管，不要主动退出 session。`;
}

function getMergedSubtaskIds(
  projectId: string,
  taskName: string,
): number[] {
  return subtaskRuns
    .listByTask(projectId, taskName)
    .filter((r) => r.state === "merged")
    .map((r) => r.subtaskId);
}

async function readPlanExcerpt(
  projectPath: string,
  taskName: string,
): Promise<string> {
  const doc = await readDocFile(projectPath, taskName, "plan");
  if (!doc) return "（未找到 plan.md）";
  const md = doc.content;
  // Extract 大哥摘要 and 目标 sections (up to first 2 KB).
  const summaryMatch = md.match(/## 大哥摘要\s*\n([\s\S]*?)(?:\n## |\n# |$)/);
  const goalMatch = md.match(/## 目标\s*\n([\s\S]*?)(?:\n## |\n# |$)/);
  const parts: string[] = [];
  if (summaryMatch) parts.push("### 大哥摘要\n" + summaryMatch[1].trim());
  if (goalMatch) parts.push("### 目标\n" + goalMatch[1].trim());
  let excerpt = parts.join("\n\n") || md.slice(0, 2048);
  if (excerpt.length > 2048) excerpt = excerpt.slice(0, 2048) + "...（截断）";
  return excerpt;
}

async function runVerifyPipeline(
  runId: string,
  projectPath: string,
  worktreePath: string,
): Promise<void> {
  subtaskRuns.markVerifying(runId);
  const result = await runVerify(worktreePath, projectPath, (chunk) => {
    subtaskRuns.appendVerifyLog(runId, chunk);
  });
  if (result.ok) {
    // 危险动作硬拦:verify 过了还要看它实际改了什么。删文件 / 动 DB 且对应边界
    // 没开 → 不进 review-ready,直接 markFailed,合并闸口拿不到它。fail-closed:
    // 检测本身出错也拦(error=true 视同命中)。
    const mgr = getAppSettings().manager;
    const scan = await scanDangerousChanges(worktreePath, projectPath);
    const blocks: string[] = [];
    if (scan.error) {
      blocks.push("危险检测失败(git diff 拿不到改动,按保险起见拦截)");
    } else {
      if (scan.deletes.length > 0 && !mgr.allowFileDelete) {
        blocks.push(`删除了文件但「允许删文件」未开启: ${scan.deletes.slice(0, 8).join(", ")}`);
      }
      if (scan.dbTouch.length > 0 && !mgr.allowDbChanges) {
        blocks.push(`改动了数据库但「允许动数据库」未开启: ${scan.dbTouch.slice(0, 8).join(", ")}`);
      }
    }
    if (blocks.length > 0) {
      const reason = `危险动作被边界拦截: ${blocks.join("; ")}`;
      subtaskRuns.markFailed(runId, reason);
      const run = subtaskRuns.get(runId);
      if (run) bumpManagerMetric(run.projectId, "dangerBlocked");
      serverLog("error", "manager", `子任务危险动作被拦截`, {
        projectId: run?.projectId,
        meta: {
          runId,
          subtaskId: run?.subtaskId,
          blocks,
          deletes: scan.deletes,
          dbTouch: scan.dbTouch,
          detectError: scan.error,
        },
      });
      if (run) {
        await appendStatusEntry(projectPath, run.taskName, {
          kind: "STEP_FAIL",
          at: Date.now(),
          sessionId: run.sessionId,
          subtaskId: run.subtaskId,
          reason: "danger-blocked",
          message: reason,
        });
      }
      return;
    }
    subtaskRuns.markReviewReady(runId);
    const run = subtaskRuns.get(runId);
    if (run) {
      await appendStatusEntry(projectPath, run.taskName, {
        kind: "STEP_DONE",
        at: Date.now(),
        sessionId: run.sessionId,
        subtaskId: run.subtaskId,
        note: "subtask verify ok, review-ready",
      });
    }
  } else {
    const errorReason = `verify failed at ${result.failedStep}: ${result.errorTail.slice(-300)}`;
    subtaskRuns.markFailed(runId, errorReason);
    const run = subtaskRuns.get(runId);
    if (run) {
      await appendStatusEntry(projectPath, run.taskName, {
        kind: "STEP_FAIL",
        at: Date.now(),
        sessionId: run.sessionId,
        subtaskId: run.subtaskId,
        message: errorReason,
      });
    }
  }
}

async function dispatchOneSubtask(
  app: FastifyInstance,
  projectId: string,
  projectPath: string,
  taskName: string,
  spec: SubtaskSpec,
  graph: SubtaskGraph,
  agent: WorktreeJobAgent,
): Promise<
  | { ok: true; runId: string }
  | { ok: false; reason: string }
> {
  const existing = subtaskRuns.getBySubtask(taskName, spec.id);
  if (existing && existing.state !== "failed" && existing.state !== "cancelled") {
    return { ok: false, reason: "already-live" };
  }

  // N3.3 熔断:同一子任务重派次数上限,防反复失败重派死循环烧 token。
  const rkey = `${projectId}::${taskName}::${spec.id}`;
  const tries = (redispatchCounts.get(rkey) ?? 0) + 1;
  redispatchCounts.set(rkey, tries);
  if (tries > MAX_REDISPATCH) {
    serverLog("error", "manager", "熔断:子任务重派次数超上限,已停止", {
      projectId,
      meta: { taskName, subtaskId: spec.id, tries, limit: MAX_REDISPATCH },
    });
    return { ok: false, reason: `redispatch-limit(${MAX_REDISPATCH})` };
  }

  const planExcerpt = await readPlanExcerpt(projectPath, taskName);
  const doneSubtasks = getMergedSubtaskIds(projectId, taskName);
  const prompt = buildSubtaskPrompt({
    taskName,
    spec,
    planExcerpt,
    doneSubtasks,
  });

  let registeredRunId: string | null = null;

  const onSignalDone = (info: WorktreeJobSpawnInfo): void => {
    if (!registeredRunId) return;
    void runVerifyPipeline(registeredRunId, projectPath, info.worktreePath);
  };
  const onSignalStuck = (
    info: WorktreeJobSpawnInfo,
    reason: string,
  ): void => {
    if (!registeredRunId) return;
    subtaskRuns.markFailed(registeredRunId, `stuck: ${reason}`);
    void appendStatusEntry(projectPath, taskName, {
      kind: "STEP_FAIL",
      at: Date.now(),
      sessionId: info.sessionId,
      subtaskId: spec.id,
      reason: "subtask-stuck",
      message: reason,
    });
  };
  const onSessionExit = (_info: WorktreeJobSpawnInfo): void => {
    if (!registeredRunId) return;
    const run = subtaskRuns.get(registeredRunId);
    if (run?.state === "running" || run?.state === "pending") {
      subtaskRuns.markCancelled(registeredRunId, "session ended before marker");
    }
  };
  // N4.1: 子工卡在歧义时写 ask 文件 → 转给经理回答。
  const onQuestion = (info: WorktreeJobSpawnInfo, question: string): void => {
    addManagerQuestion({
      projectId,
      taskName,
      subtaskId: spec.id,
      worktreePath: info.worktreePath,
      question,
    });
  };

  const spawnResult = await spawnWorktreeJob({
    app,
    projectId,
    task: `${taskName}::${spec.id}`,
    agent,
    prompt,
    jobLabel: `subtask:${spec.id}::${taskName}`,
    onSignalDone,
    onSignalStuck,
    onSessionExitBeforeMarker: onSessionExit,
    onQuestion,
  });

  if (!spawnResult.ok) {
    return { ok: false, reason: spawnResult.reason };
  }

  const run = subtaskRuns.register({
    projectId,
    taskName,
    subtaskId: spec.id,
    title: spec.title,
    worktreePath: spawnResult.info.worktreePath,
    branch: spawnResult.info.branch,
  });
  registeredRunId = run.runId;
  subtaskRuns.markRunning(run.runId, spawnResult.info.sessionId);

  await writeSubtaskMeta(projectPath, {
    runId: run.runId,
    projectId,
    taskName,
    subtaskId: spec.id,
    title: spec.title,
    worktreePath: spawnResult.info.worktreePath,
    branch: spawnResult.info.branch,
    sessionId: spawnResult.info.sessionId,
    startedAt: run.startedAt,
  });

  void appendStatusEntry(projectPath, taskName, {
    kind: "RESUME",
    at: Date.now(),
    sessionId: spawnResult.info.sessionId,
    subtaskId: spec.id,
    note: `subtask #${spec.id} dispatched: ${spec.title}`,
  });

  // Track graph for downstream wave dispatching.
  // (No-op here; routes layer keeps the graph in caller scope.)
  void graph;

  bumpManagerMetric(projectId, "dispatched");
  return { ok: true, runId: run.runId };
}

// ---------- WS bus wiring ----------

let busWired = false;
function wireSubtaskBus(): void {
  if (busWired) return;
  busWired = true;
  subtaskRuns.on(
    "state-change",
    (runId: string, newState: SubtaskRunState, oldState: SubtaskRunState) => {
      const run = subtaskRuns.get(runId);
      if (!run) return;
      broadcast({
        type: "subtask-run-state",
        runId,
        state: newState,
        oldState,
        run,
      });
    },
  );
  subtaskRuns.on("verify-log", (runId: string, chunk: string) => {
    broadcast({ type: "subtask-run-verify-log", runId, chunk });
  });
  subtaskRuns.on("remove", (runId: string) => {
    broadcast({ type: "subtask-run-remove", runId });
  });
}

// ---------- Routes ----------

export async function registerTaskSubtaskRoutes(
  app: FastifyInstance,
): Promise<void> {
  wireSubtaskBus();

  app.get<{ Params: { id: string; task: string } }>(
    "/api/projects/:id/tasks/:task/subtasks",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const taskName = decodeURIComponent(req.params.task);

      // Re-import orphans from disk.
      const orphans = await loadSubtaskOrphans(proj.path, taskName);
      for (const o of orphans) {
        const existing = subtaskRuns.getBySubtask(taskName, o.subtaskId);
        if (existing) continue;
        if (!existsSync(o.worktreePath)) {
          await deleteSubtaskMeta(proj.path, taskName, o.subtaskId);
          continue;
        }
        subtaskRuns.registerOrphan({
          projectId: proj.id,
          taskName,
          subtaskId: o.subtaskId,
          title: o.title,
          worktreePath: o.worktreePath,
          branch: o.branch,
        });
      }

      const doc = await readDocFile(proj.path, taskName, "plan");
      const parse: ParseSubtasksResult = doc
        ? parseSubtasksFromPlan(doc.content)
        : { ok: false, reason: "no-section" };

      const runs = subtaskRuns.listByTask(proj.id, taskName);

      if (!parse.ok) {
        return reply.send({
          parsed: false,
          parseReason: parse.reason,
          parseDetail: parse.detail ?? null,
          runs,
          graph: null,
        });
      }

      return reply.send({
        parsed: true,
        graph: parse.graph,
        runs,
      });
    },
  );

  // 经理战绩指标(N2.3 价值闸门):返回该项目累计计数,前端算"省手/一次通过率/返工率"。
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/manager-metrics",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      return reply.send(getManagerMetrics(proj.id));
    },
  );

  // 派工前:解析任务图、发放绑定其 hash 的确认凭证。UI「派工」按钮(=用户本人)
  // 先弹确认框给大哥看图,确认后调本接口拿 token,再带 token 调 dispatch。
  app.post<{ Params: { id: string; task: string } }>(
    "/api/projects/:id/tasks/:task/prepare-dispatch",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const taskName = decodeURIComponent(req.params.task);
      const doc = await readDocFile(proj.path, taskName, "plan");
      if (!doc) return reply.code(404).send({ error: "plan_not_found" });
      const result = parseSubtasksFromPlan(doc.content);
      if (!result.ok) {
        return reply
          .code(400)
          .send({ error: result.reason, detail: result.detail ?? null });
      }
      const graph = result.graph;
      const graphHash = computeGraphHash(graph);
      const token = randomUUID();
      dispatchTokens.set(tokenKey(proj.id, taskName), { graphHash, token });
      return reply.send({ ok: true, token, graphHash, graph });
    },
  );

  app.post<{
    Params: { id: string; task: string };
    Body: unknown;
  }>(
    "/api/projects/:id/tasks/:task/dispatch-subtasks",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const taskName = decodeURIComponent(req.params.task);
      const parsed = DispatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const agent = parsed.data.agent ?? "claude";
      // 并发上限以「经理 AI 边界」设置为权威;请求体可再调低但不能超过它。
      const mgr = getAppSettings().manager;
      const cap = mgr.concurrency;
      const concurrency = Math.min(
        parsed.data.maxConcurrency ?? cap,
        cap,
      );

      const doc = await readDocFile(proj.path, taskName, "plan");
      if (!doc) {
        return reply.code(404).send({ error: "plan_not_found" });
      }
      const result = parseSubtasksFromPlan(doc.content);
      if (!result.ok) {
        const isCycle = result.reason === "cycle";
        return reply
          .code(isCycle ? 400 : 400)
          .send({
            error: result.reason,
            detail: result.detail ?? null,
          });
      }

      const graph = result.graph;

      // 派工前确认凭证:confirmGraph 开时必须带与当前任务图 hash 匹配的 token。
      // 裸 curl 不带 token / token 过期 / 任务图已变 → 一律拒,杜绝绕过用户确认。
      if (mgr.confirmGraph) {
        const key = tokenKey(proj.id, taskName);
        const pending = dispatchTokens.get(key);
        const currentHash = computeGraphHash(graph);
        const provided = parsed.data.confirmToken;
        if (
          !provided ||
          !pending ||
          pending.token !== provided ||
          pending.graphHash !== currentHash
        ) {
          serverLog("warn", "manager", "派工被拒:确认凭证缺失/失效/任务图已变", {
            projectId: proj.id,
            meta: {
              taskName,
              hasToken: Boolean(provided),
              hasPending: Boolean(pending),
              graphChanged: pending ? pending.graphHash !== currentHash : null,
            },
          });
          return reply.code(409).send({
            error: "confirm_required",
            detail:
              "派工前需在面板确认任务图(确认凭证缺失、已失效,或任务图已变更)",
          });
        }
        dispatchTokens.delete(key); // 一次性消费
      }

      const waves = topologicalWaves(graph);

      const active = subtaskRuns.countActive(proj.id);
      const wantToStart = graph.subtasks.length;
      if (active + wantToStart > MAX_CONCURRENCY * 3) {
        return reply.code(409).send({
          error: "pool_full",
          detail: `active=${active}, requested=${wantToStart}`,
        });
      }

      serverLog("info", "subtasks", "dispatch 开始", {
        projectId: proj.id,
        meta: {
          taskName,
          totalSubtasks: graph.subtasks.length,
          waves: waves.map((w) => w.length),
        },
      });
      const t0 = Date.now();

      // Dispatch only the first wave synchronously; subsequent waves are
      // triggered by state-change events (see waveAdvancer below).
      const firstWave = waves[0] ?? [];
      const specsById = new Map(graph.subtasks.map((s) => [s.id, s]));
      const results: Array<{
        subtaskId: number;
        ok: boolean;
        runId?: string;
        reason?: string;
      }> = [];

      // 项目级并发:初始只派"剩余空位"个(已被别的图占用的算进去)。
      // 没派完的(本波剩余 + 后续波)交给 advancer 在空位释放/上游就绪时补派。
      const slots = Math.max(0, concurrency - subtaskRuns.countActive(proj.id));
      const firstSlice = firstWave.slice(0, slots);
      for (const id of firstSlice) {
        const spec = specsById.get(id);
        if (!spec) continue;
        const r = await dispatchOneSubtask(
          app,
          proj.id,
          proj.path,
          taskName,
          spec,
          graph,
          agent,
        );
        if (r.ok) {
          results.push({ subtaskId: id, ok: true, runId: r.runId });
        } else {
          results.push({ subtaskId: id, ok: false, reason: r.reason });
        }
      }

      // 只要还有没派出去的子任务(本波因并发没派满 / 后续波),就挂 advancer。
      // 它监听全局 state-change,在空位释放或上游就绪时补派,并执行下游阻塞 /
      // 出错即停 / 每波重读并发设置。
      if (firstSlice.length < graph.subtasks.length) {
        wireWaveAdvancer({
          app,
          projectId: proj.id,
          projectPath: proj.path,
          taskName,
          graph,
          agent,
        });
      }

      const okCount = results.filter((r) => r.ok).length;
      bumpManagerMetric(proj.id, "batches");
      serverLog(
        "info",
        "subtasks",
        `dispatch 成功 (${Date.now() - t0}ms)`,
        {
          projectId: proj.id,
          meta: { taskName, ok: okCount, total: results.length },
        },
      );

      return reply.send({
        ok: true,
        graph,
        firstWaveResults: results,
        totalWaves: waves.length,
      });
    },
  );

  app.post<{
    Params: { id: string; task: string };
  }>(
    "/api/projects/:id/tasks/:task/approve-all",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const taskName = decodeURIComponent(req.params.task);

      const doc = await readDocFile(proj.path, taskName, "plan");
      if (!doc) return reply.code(404).send({ error: "plan_not_found" });
      const result = parseSubtasksFromPlan(doc.content);
      if (!result.ok) {
        return reply
          .code(400)
          .send({ error: result.reason, detail: result.detail ?? null });
      }
      const order = result.graph.order;

      serverLog("info", "subtasks", "approve-all 开始", {
        projectId: proj.id,
        meta: { taskName, order },
      });
      const t0 = Date.now();

      const merged: number[] = [];
      const failed: Array<{ subtaskId: number; reason: string }> = [];

      for (const id of order) {
        const run = subtaskRuns.getBySubtask(taskName, id);
        if (!run) {
          failed.push({ subtaskId: id, reason: "run-not-found" });
          break;
        }
        if (run.state === "merged") {
          merged.push(id);
          continue;
        }
        if (run.state !== "review-ready" && run.state !== "unknown") {
          failed.push({
            subtaskId: id,
            reason: `wrong-state: ${run.state}`,
          });
          break;
        }

        const mergeRes = await runGit(proj.path, [
          "merge",
          "--no-ff",
          "--no-edit",
          run.branch,
        ]);
        if (!mergeRes.ok) {
          subtaskRuns.markMergeConflict(
            run.runId,
            (mergeRes.stderr || mergeRes.stdout).slice(-500),
          );
          bumpManagerMetric(proj.id, "mergeConflict");
          failed.push({
            subtaskId: id,
            reason: `merge-conflict: ${(mergeRes.stderr || mergeRes.stdout).slice(-300)}`,
          });
          await appendStatusEntry(proj.path, taskName, {
            kind: "STEP_FAIL",
            at: Date.now(),
            subtaskId: id,
            reason: "merge-conflict",
            message: (mergeRes.stderr || mergeRes.stdout).slice(-300),
          });
          serverLog("error", "subtasks", "approve-all 中断 (merge conflict)", {
            projectId: proj.id,
            meta: { taskName, subtaskId: id },
          });
          break;
        }

        const wtRes = await runGit(proj.path, [
          "worktree",
          "remove",
          "--force",
          run.worktreePath,
        ]);
        if (!wtRes.ok) {
          serverLog(
            "warn",
            "subtasks",
            "worktree-remove 失败（merge 已成功）",
            {
              projectId: proj.id,
              meta: { taskName, subtaskId: id, stderr: wtRes.stderr.slice(-300) },
            },
          );
        }

        subtaskRuns.markMerged(run.runId);
        bumpManagerMetric(proj.id, "merged");
        await deleteSubtaskMeta(proj.path, taskName, id);
        await appendStatusEntry(proj.path, taskName, {
          kind: "STEP_DONE",
          at: Date.now(),
          subtaskId: id,
          note: "approve-all merged",
        });
        merged.push(id);
      }

      serverLog(
        "info",
        "subtasks",
        `approve-all 完成 (${Date.now() - t0}ms)`,
        { projectId: proj.id, meta: { taskName, merged, failed } },
      );

      return reply.send({
        ok: failed.length === 0,
        merged,
        failed,
      });
    },
  );

  // 经理 AI 自动合并:仅在「允许自动合并」边界开启时放行,否则 403。
  // 复用人工 approve-all 的合并逻辑(只合 review-ready 的;危险动作早在进
  // review-ready 前就被硬拦,所以这里合的都是已过验证+危险检测的安全子任务)。
  app.post<{ Params: { id: string; task: string } }>(
    "/api/projects/:id/tasks/:task/auto-approve-all",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      if (!getAppSettings().manager.allowAutoMerge) {
        serverLog("warn", "manager", "自动合并被拒:allowAutoMerge 未开启", {
          projectId: proj.id,
          meta: { taskName: decodeURIComponent(req.params.task) },
        });
        return reply.code(403).send({
          error: "auto_merge_disabled",
          detail:
            "「允许自动合并」未开启,经理 AI 不能自动合并;请人工在面板放行,或去设置开启该边界",
        });
      }
      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${encodeURIComponent(proj.id)}/tasks/${encodeURIComponent(decodeURIComponent(req.params.task))}/approve-all`,
      });
      return reply.code(res.statusCode).send(res.json());
    },
  );

  app.post<{
    Params: { id: string; task: string; subtaskId: string };
  }>(
    "/api/projects/:id/tasks/:task/subtasks/:subtaskId/approve",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const taskName = decodeURIComponent(req.params.task);
      const subtaskId = parseInt(req.params.subtaskId, 10);
      if (!Number.isInteger(subtaskId) || subtaskId < 1) {
        return reply.code(400).send({ error: "invalid_subtask_id" });
      }
      const run = subtaskRuns.getBySubtask(taskName, subtaskId);
      if (!run) return reply.code(404).send({ error: "run_not_found" });
      if (run.state !== "review-ready" && run.state !== "unknown") {
        return reply.code(409).send({
          error: "wrong_state",
          detail: `cannot approve from state '${run.state}'`,
        });
      }

      const mergeRes = await runGit(proj.path, [
        "merge",
        "--no-ff",
        "--no-edit",
        run.branch,
      ]);
      if (!mergeRes.ok) {
        subtaskRuns.markMergeConflict(
          run.runId,
          (mergeRes.stderr || mergeRes.stdout).slice(-500),
        );
        bumpManagerMetric(proj.id, "mergeConflict");
        return reply.code(409).send({
          error: "merge_conflict",
          detail: (mergeRes.stderr || mergeRes.stdout).slice(-500),
        });
      }
      const wtRes = await runGit(proj.path, [
        "worktree",
        "remove",
        "--force",
        run.worktreePath,
      ]);
      if (!wtRes.ok) {
        serverLog(
          "warn",
          "subtasks",
          "approve worktree-remove 失败（merge 已成功）",
          {
            projectId: proj.id,
            meta: { taskName, subtaskId, stderr: wtRes.stderr.slice(-300) },
          },
        );
      }
      subtaskRuns.markMerged(run.runId);
      bumpManagerMetric(proj.id, "merged");
      await deleteSubtaskMeta(proj.path, taskName, subtaskId);
      return reply.send({ ok: true });
    },
  );

  app.delete<{
    Params: { id: string; task: string; subtaskId: string };
  }>(
    "/api/projects/:id/tasks/:task/subtasks/:subtaskId",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const taskName = decodeURIComponent(req.params.task);
      const subtaskId = parseInt(req.params.subtaskId, 10);
      if (!Number.isInteger(subtaskId) || subtaskId < 1) {
        return reply.code(400).send({ error: "invalid_subtask_id" });
      }
      const run = subtaskRuns.getBySubtask(taskName, subtaskId);
      if (!run) return reply.code(404).send({ error: "run_not_found" });

      const wtRes = await runGit(proj.path, [
        "worktree",
        "remove",
        "--force",
        run.worktreePath,
      ]);
      if (!wtRes.ok) {
        serverLog("warn", "subtasks", "reject worktree-remove 失败", {
          projectId: proj.id,
          meta: { taskName, subtaskId, stderr: wtRes.stderr.slice(-300) },
        });
      }
      await deleteSubtaskMeta(proj.path, taskName, subtaskId);
      subtaskRuns.remove(run.runId);
      redispatchCounts.delete(`${proj.id}::${taskName}::${subtaskId}`);
      bumpManagerMetric(proj.id, "rejected");
      return reply.send({ ok: true });
    },
  );
}

// ---------- Wave advancer ----------

interface WaveAdvancerOpts {
  app: FastifyInstance;
  projectId: string;
  projectPath: string;
  taskName: string;
  graph: SubtaskGraph;
  agent: WorktreeJobAgent;
}

const advancersByTask = new Map<string, (...args: unknown[]) => void>();

/**
 * Listens for subtask state-change events on the current task and, when any
 * subtask becomes review-ready (i.e. has finished its verify pipeline), checks
 * whether the next wave can now start. A subtask starts as soon as all of its
 * depends_on are in `review-ready` or `merged` state.
 *
 * Detached as soon as the entire graph has been dispatched.
 */
function wireWaveAdvancer(opts: WaveAdvancerOpts): void {
  const key = `${opts.projectId}::${opts.taskName}`;
  // Clear any previous advancer for the same task to avoid duplicate dispatches.
  const existing = advancersByTask.get(key);
  if (existing) {
    subtaskRuns.off("state-change", existing);
    advancersByTask.delete(key);
  }

  let active = true;
  // 函数声明(而非 const 箭头)以规避 detach/handler 互相引用的 TDZ。
  function detach(): void {
    active = false;
    subtaskRuns.off("state-change", handler);
    advancersByTask.delete(key);
  }

  function handler(..._args: unknown[]): void {
    if (!active) return;
    // 每 tick 重读设置:中途改并发 / 出错即停能即时生效。
    const mgr = getAppSettings().manager;
    const runs = subtaskRuns.listByTask(opts.projectId, opts.taskName);
    // 失败集合:这些子任务的下游永远不该再派(下游阻塞)。merge-conflict 也算失败,
    // 不能像旧代码那样当 ready 放行下游。
    const failedIds = new Set(
      runs
        .filter(
          (r) =>
            r.state === "failed" ||
            r.state === "cancelled" ||
            r.state === "merge-conflict",
        )
        .map((r) => r.subtaskId),
    );

    // 出错即停:开了就停掉本图所有未派发波次。
    if (mgr.stopOnFailure && failedIds.size > 0) {
      serverLog("warn", "manager", "出错即停:停止该任务图未派发的后续波次", {
        projectId: opts.projectId,
        meta: { taskName: opts.taskName, failed: [...failedIds] },
      });
      detach();
      return;
    }

    const readyIds = new Set(
      runs
        .filter((r) => r.state === "review-ready" || r.state === "merged")
        .map((r) => r.subtaskId),
    );
    const dispatchedIds = new Set(runs.map((r) => r.subtaskId));

    for (const spec of opts.graph.subtasks) {
      if (dispatchedIds.has(spec.id)) continue;
      // 下游阻塞:任一依赖已失败 → 该子任务不派(等于阻塞,留在未派发集合)。
      if (spec.depends_on.some((d) => failedIds.has(d))) continue;
      // 依赖必须全部 review-ready / merged 才能派。
      const ready = spec.depends_on.every((d) => readyIds.has(d));
      if (!ready) continue;
      // 项目级并发上限:满了就停,下次 state-change 再补派。
      if (subtaskRuns.countActive(opts.projectId) >= mgr.concurrency) break;
      void dispatchOneSubtask(
        opts.app,
        opts.projectId,
        opts.projectPath,
        opts.taskName,
        spec,
        opts.graph,
        opts.agent,
      );
      dispatchedIds.add(spec.id);
    }

    // 剩下没派的若全都卡在"失败依赖"上(再也不会就绪),就收摊。
    const remaining = opts.graph.subtasks.filter((s) => !dispatchedIds.has(s.id));
    const allBlocked =
      remaining.length > 0 &&
      remaining.every((s) => s.depends_on.some((d) => failedIds.has(d)));
    if (remaining.length === 0 || allBlocked) {
      detach();
    }
  }

  subtaskRuns.on("state-change", handler);
  advancersByTask.set(key, handler);
}
