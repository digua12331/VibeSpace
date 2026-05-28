import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getProject } from "../db.js";
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
  spawnWorktreeJob,
  type WorktreeJobAgent,
  type WorktreeJobSpawnInfo,
} from "../worktree-session-runner.js";
import { appendStatusEntry } from "../task-status.js";
import { broadcast } from "../ws-hub.js";
import { existsSync } from "node:fs";

const SUBTASK_DONE_MARKER = "===SUBTASK-DONE===";
const SUBTASK_STUCK_MARKER = "===SUBTASK-STUCK===";
const MAX_CONCURRENCY = 5;
const DEFAULT_CONCURRENCY = 3;

const DispatchSchema = z.object({
  agent: z.enum(["claude", "codex", "shell"]).optional(),
  maxConcurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
});

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

## 完成约定
- 完成后**单独打印一行**：
  ${SUBTASK_DONE_MARKER}
- 无法完成（连续 2-3 次失败、范围超出 write_files）打印：
  ${SUBTASK_STUCK_MARKER} <一句话原因>
- 打印 marker 后等待 verify pipeline 接管，不要主动退出 session。`;
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

  const planExcerpt = await readPlanExcerpt(projectPath, taskName);
  const doneSubtasks = getMergedSubtaskIds(projectId, taskName);
  const prompt = buildSubtaskPrompt({
    taskName,
    spec,
    planExcerpt,
    doneSubtasks,
  });

  let registeredRunId: string | null = null;

  const onMarkerDone = (info: WorktreeJobSpawnInfo): void => {
    if (!registeredRunId) return;
    void runVerifyPipeline(registeredRunId, projectPath, info.worktreePath);
  };
  const onMarkerStuck = (
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

  const spawnResult = await spawnWorktreeJob({
    app,
    projectId,
    task: `${taskName}::${spec.id}`,
    agent,
    prompt,
    markerDone: SUBTASK_DONE_MARKER,
    markerStuck: SUBTASK_STUCK_MARKER,
    jobLabel: `subtask:${spec.id}::${taskName}`,
    onMarkerDone,
    onMarkerStuck,
    onSessionExitBeforeMarker: onSessionExit,
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
      const concurrency =
        parsed.data.maxConcurrency ?? DEFAULT_CONCURRENCY;

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

      // Apply concurrency cap to the first wave only.
      const firstSlice = firstWave.slice(0, concurrency);
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

      // Wire a wave advancer if there are more waves.
      if (waves.length > 1) {
        wireWaveAdvancer({
          app,
          projectId: proj.id,
          projectPath: proj.path,
          taskName,
          graph,
          agent,
          concurrency,
        });
      }

      const okCount = results.filter((r) => r.ok).length;
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
  concurrency: number;
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

  const specsById = new Map(opts.graph.subtasks.map((s) => [s.id, s]));
  let active = true;

  const handler = (..._args: unknown[]): void => {
    if (!active) return;
    const runs = subtaskRuns.listByTask(opts.projectId, opts.taskName);
    const readyIds = new Set(
      runs
        .filter(
          (r) =>
            r.state === "review-ready" ||
            r.state === "merged" ||
            r.state === "merge-conflict",
        )
        .map((r) => r.subtaskId),
    );
    const dispatchedIds = new Set(runs.map((r) => r.subtaskId));

    for (const spec of opts.graph.subtasks) {
      if (dispatchedIds.has(spec.id)) continue;
      // All deps must be review-ready or merged.
      const ready = spec.depends_on.every((d) => readyIds.has(d));
      if (!ready) continue;
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

    // Detach when everything dispatched.
    if (dispatchedIds.size === opts.graph.subtasks.length) {
      active = false;
      subtaskRuns.off("state-change", handler);
      advancersByTask.delete(key);
    }
  };

  subtaskRuns.on("state-change", handler);
  advancersByTask.set(key, handler);

  // Mark unused parameter for tooling.
  void specsById;
}
