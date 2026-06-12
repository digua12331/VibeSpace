/**
 * Hub routes —— "总控台第一期" 后端聚合 + 派工入口。
 *
 *   GET  /api/hub/status              轻数据：projects + alive AI sessions + mem
 *   GET  /api/hub/projects/:id/detail 重数据：git dirty + dev/active tasks (按需拉)
 *   POST /api/hub/dispatch            在指定项目下新建 session 并把 text 作为首句发送
 *
 * 设计要点（详见 dev/active/总控台第一期/{plan,context}.md）：
 *  - hub 不是 project：所有现有按 projectId 工作的路由都不动；前端用 selectedView='hub'
 *    切视图，本路由只是给那个视图喂数据。
 *  - dispatch **只支持新建** session，**不支持派给已有 session**——目标 PTY 状态未知
 *    （idle / running / TUI 全屏 / 等输入），sendInput 会破坏当前 prompt。需要 session
 *    状态机才能稳，留待第 2 期。
 *  - dispatch 内部用 `app.inject('POST /api/sessions')` 复用 startSession 完整流程
 *    （worktree / MCP 注入 / skills / hook），不绕过、不简化。
 *  - 接口签名按"未来 MCP 工具可直接调"设计：参数自完备、zod 校验、操作日志完整。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BUILTIN_SHELL_AGENTS,
  getProject,
  getSession,
  listProjects,
  listSessions,
  type SessionStatus,
} from "../db.js";
import { HUB_PROJECT_ID } from "../hub-project.js";
import { ptyManager, lastInputAt } from "../pty-manager.js";
import { statusManager } from "../status.js";
import { getCliEntry } from "../cli-catalog.js";
import { getChanges, listCommits } from "../git-service.js";
import { listDocs } from "../docs-service.js";
import { getMemByProject } from "../process-mem-service.js";
import { serverLog } from "../log-bus.js";
import { resolveWithinProject, readGuarded } from "../hub-path-guard.js";
import { sendToOwner } from "../feishu/outbound.js";
import { resolveWechatReply } from "../wechat/inbound.js";

const SHELL_SET = new Set<string>(BUILTIN_SHELL_AGENTS);
const BUILTIN = new Set<string>(BUILTIN_SHELL_AGENTS);

// ---------- Wire types (shape that the web client consumes) ----------

interface HubSession {
  id: string;
  agent: string;
  status: SessionStatus;
  pid: number | null;
  startedAt: number;
  lastInputAt: number | null;
  lastOutputAt: number | null;
}

interface HubProject {
  id: string;
  name: string;
  path: string;
  /** Count of alive AI sessions (shell sessions are excluded, matching mem-service口径). */
  aliveSessionCount: number;
  sessions: HubSession[];
  /** Sum of WorkingSet across all alive AI sessions' process trees (Windows only;
   *  0 on platforms where process-mem-service can't sample). */
  totalMemBytes: number;
  /** max(startedAt, lastInputAt, lastOutputAt) over alive AI sessions, or null. */
  lastActivityAt: number | null;
}

interface HubStatusResponse {
  projects: HubProject[];
  ts: number;
}

interface HubProjectDetail {
  /** null when the project isn't a git repo or git status failed. */
  gitDirty: {
    enabled: boolean;
    branch: string | null;
    ahead: number;
    behind: number;
    staged: number;
    unstaged: number;
    untracked: number;
  } | null;
  devTasks: Array<{
    name: string;
    status: string;
    checked: number;
    total: number;
    updatedAt: number;
  }>;
  /** Reserved for Phase 2 (error-pattern-monitor wiring). Always null in Phase 1. */
  errorCount24h: number | null;
}

interface HubDispatchResponse {
  sessionId: string;
  /** false when PTY died between spawn and the first write (rare). */
  firstInputWritten: boolean;
}

// ---------- Schemas ----------

const DispatchSchema = z.object({
  targetProjectId: z.string().min(1),
  agent: z.string().min(1).refine(
    (id) => BUILTIN.has(id) || !!getCliEntry(id),
    { message: "unknown agent" },
  ),
  text: z.string().min(1).max(20_000),
});

// B1 第 3 期：派给已有 idle session。严格约束见 plan D8 错误码表。
const DispatchToIdleSchema = z.object({
  targetSessionId: z.string().min(1),
  text: z.string().min(1).max(20_000),
});

// 飞书桥：总控台主动给大哥发消息（send_feishu_message 工具的后端端点）。
const SendFeishuSchema = z.object({
  text: z.string().min(1).max(8000),
});

// 飞书桥：总控台替大哥回某个 worker 的输入（send_input_to_session 工具）。
const SendInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(20_000),
});

// 微信桥：总控台回复某条微信入站消息（send_wechat_reply 工具的后端端点）。
const SendWechatReplySchema = z.object({
  requestId: z.string().min(1).max(64),
  text: z.string().min(1).max(8000),
});

// send_input_to_session 的并发短锁：防总控台被诱导对同一 worker 连发抢人类输入。
const sendInputLocks = new Set<string>();

// Idle session 派工常量 (Codex 评审 D2-D3)
const HUB_IDLE_MIN_AGE_MS = 800;        // status===idle 必须持续至少 800ms
const HUB_RECENT_INPUT_WINDOW_MS = 1000; // 最近 1s 有人类输入则拒绝

/** 剥除 C0 控制字符 (除 \t \n \r) 和 DEL，防 hub claude 注入终端控制序列。 */
function sanitizeDispatchText(s: string): string {
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

// ---------- Routes ----------

export async function registerHubRoutes(app: FastifyInstance): Promise<void> {
  // High-frequency read; not logged per CLAUDE.md "操作日志规则" exemption.
  app.get("/api/hub/status", async () => {
    const projects = listProjects();
    const allSessions = listSessions();
    const memByProject = getMemByProject();

    const result: HubProject[] = projects.map((p) => {
      const sessions: HubSession[] = allSessions
        .filter((s) => s.projectId === p.id)
        .filter((s) => ptyManager.has(s.id))
        .filter((s) => !SHELL_SET.has(s.agent))
        .map((s) => {
          const live = statusManager.get(s.id);
          return {
            id: s.id,
            agent: s.agent,
            status: (live ?? s.status) as SessionStatus,
            pid: s.pid,
            startedAt: s.startedAt,
            lastInputAt: s.lastInputAt,
            lastOutputAt: s.lastOutputAt,
          };
        });

      let lastActivityAt: number | null = null;
      for (const s of sessions) {
        const max = Math.max(
          s.startedAt,
          s.lastInputAt ?? 0,
          s.lastOutputAt ?? 0,
        );
        if (lastActivityAt == null || max > lastActivityAt) lastActivityAt = max;
      }

      return {
        id: p.id,
        name: p.name,
        path: p.path,
        aliveSessionCount: sessions.length,
        sessions,
        totalMemBytes: memByProject[p.id] ?? 0,
        lastActivityAt,
      };
    });

    const response: HubStatusResponse = { projects: result, ts: Date.now() };
    return response;
  });

  // On-demand heavy data; high-frequency read, not logged.
  app.get<{ Params: { id: string } }>(
    "/api/hub/projects/:id/detail",
    async (req, reply) => {
      const p = getProject(req.params.id);
      if (!p) return reply.code(404).send({ error: "project_not_found" });

      let gitDirty: HubProjectDetail["gitDirty"] = null;
      try {
        const c = await getChanges(p.path);
        gitDirty = {
          enabled: c.enabled,
          branch: c.branch,
          ahead: c.ahead,
          behind: c.behind,
          staged: c.staged.length,
          unstaged: c.unstaged.length,
          untracked: c.untracked.length,
        };
      } catch {
        // Not a git repo or git failed — field stays null, front-end shows "—".
      }

      let devTasks: HubProjectDetail["devTasks"] = [];
      try {
        const docs = await listDocs(p.path);
        devTasks = docs.map((d) => ({
          name: d.name,
          status: d.status,
          checked: d.checked,
          total: d.total,
          updatedAt: d.updatedAt,
        }));
      } catch {
        // dev/active dir missing or read failed — empty list.
      }

      const response: HubProjectDetail = {
        gitDirty,
        devTasks,
        errorCount24h: null,
      };
      return reply.send(response);
    },
  );

  app.post("/api/hub/dispatch", async (req, reply) => {
    const parsed = DispatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { targetProjectId, agent, text } = parsed.data;
    const proj = getProject(targetProjectId);
    if (!proj) return reply.code(404).send({ error: "project_not_found" });

    const t0 = Date.now();
    serverLog("info", "hub", "dispatch 开始", {
      projectId: targetProjectId,
      meta: { agent, textPreview: text.slice(0, 80), textLen: text.length },
    });

    // In-process HTTP call reuses the full create-session pipeline
    // (worktree / MCP injection / skills / hook); don't reimplement.
    let sessionId: string;
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { projectId: targetProjectId, agent },
      });
      if (res.statusCode !== 201) {
        serverLog("error", "hub", `dispatch 失败: createSession 返回 ${res.statusCode}`, {
          projectId: targetProjectId,
          meta: { agent, statusCode: res.statusCode, body: res.body.slice(0, 200) },
        });
        return reply.code(res.statusCode).send({
          error: "create_session_failed",
          detail: res.body.slice(0, 500),
        });
      }
      const parsedBody = JSON.parse(res.body) as { id: string };
      sessionId = parsedBody.id;
    } catch (err) {
      const e = err as Error;
      serverLog("error", "hub", `dispatch 失败: ${e.message}`, {
        projectId: targetProjectId,
        meta: { agent, error: { name: e.name, message: e.message } },
      });
      return reply.code(500).send({ error: "dispatch_failed", message: e.message });
    }

    // PTY spawn is synchronous inside startSession (returns after pid is set),
    // so the child process is already running by the time inject returns. We
    // append \r so the CLI's readline consumes the line as soon as it's ready.
    const ok = ptyManager.write(sessionId, text + "\r");
    if (!ok) {
      const ms = Date.now() - t0;
      serverLog("warn", "hub", `dispatch 首句写入失败 (${ms}ms) —— session 已建但 PTY 写入失败`, {
        projectId: targetProjectId,
        sessionId,
        meta: { agent, textPreview: text.slice(0, 80) },
      });
      const response: HubDispatchResponse = { sessionId, firstInputWritten: false };
      return reply.send(response);
    }

    const ms = Date.now() - t0;
    serverLog("info", "hub", `dispatch 成功 (${ms}ms)`, {
      projectId: targetProjectId,
      sessionId,
      meta: { agent, textPreview: text.slice(0, 80), textLen: text.length },
    });
    const response: HubDispatchResponse = { sessionId, firstInputWritten: true };
    return reply.send(response);
  });

  // -------- Phase 2: read-only project helpers for MCP hub tools --------

  // Recent commits — high-frequency read, not logged. Used by MCP read_git_log.
  app.get<{ Params: { id: string }; Querystring: { n?: string } }>(
    "/api/hub/projects/:id/git-log",
    async (req, reply) => {
      const p = getProject(req.params.id);
      if (!p) return reply.code(404).send({ error: "project_not_found" });
      const n = Math.max(1, Math.min(Number(req.query.n ?? 10) || 10, 50));
      try {
        const commits = await listCommits(p.path, { limit: n });
        return reply.send({
          commits: commits.map((c) => ({
            sha: c.shortSha,
            fullSha: c.sha,
            subject: c.subject,
            author: c.author,
            date: c.date,
          })),
        });
      } catch (err) {
        return reply.code(500).send({
          error: "git_log_failed",
          message: (err as Error).message,
        });
      }
    },
  );

  // Read a file under the project root with path-escape / size / binary
  // guards (hub-path-guard.ts). Used by MCP read_file.
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/api/hub/projects/:id/file",
    async (req, reply) => {
      const p = getProject(req.params.id);
      if (!p) return reply.code(404).send({ error: "project_not_found" });
      const relPath = req.query.path ?? "";
      const resolved = resolveWithinProject(p.path, relPath);
      if (!resolved.ok) {
        return reply.code(400).send({
          error: resolved.error.code,
          message: resolved.error.message,
        });
      }
      const read = await readGuarded(resolved.absPath);
      if (!read.ok) {
        const status = read.error.code === "not_found" ? 404 : 400;
        return reply.code(status).send({
          error: read.error.code,
          message: read.error.message,
          ...("sizeBytes" in read.error
            ? { sizeBytes: read.error.sizeBytes, maxBytes: read.error.maxBytes }
            : {}),
        });
      }
      return reply.send({
        path: relPath,
        sizeBytes: read.sizeBytes,
        content: read.content,
      });
    },
  );

  // B1: 派给已有 idle claude session (第 3 期)。前置条件：claude agent +
  // PTY 活 + status==='idle' 且持续 ≥ 800ms + 最近 1s 无人类输入 + 未被锁。
  app.post("/api/hub/dispatch-to-idle-session", async (req, reply) => {
    const parsed = DispatchToIdleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { targetSessionId, text } = parsed.data;
    const cleanText = sanitizeDispatchText(text);
    if (cleanText.length === 0) {
      return reply.code(400).send({ error: "invalid_body", detail: "text empty after sanitize" });
    }

    const t0 = Date.now();
    const row = getSession(targetSessionId);
    if (!row) return reply.code(404).send({ error: "session_not_found" });

    // 初版只 claude (Codex 第 9 点：codex idle 判断弱)
    if (row.agent !== "claude") {
      return reply
        .code(400)
        .send({ error: "not_ai_session", currentAgent: row.agent });
    }
    if (!ptyManager.has(targetSessionId)) {
      return reply.code(400).send({ error: "no_live_pty" });
    }
    // waiting_input: claude 等用户答 yes/no/选项；派工=替用户回答危险
    const liveStatus = statusManager.get(targetSessionId);
    if (liveStatus === "waiting_input") {
      return reply.code(400).send({ error: "waiting_input" });
    }
    // 最近 1s 有人类输入则拒绝（防同毫秒撞车）
    const lastIn = lastInputAt.get(targetSessionId);
    if (lastIn != null && Date.now() - lastIn < HUB_RECENT_INPUT_WINDOW_MS) {
      return reply.code(400).send({
        error: "recently_typed",
        sinceMs: Date.now() - lastIn,
      });
    }

    // 原子抢占
    const claim = statusManager.claimIdle(targetSessionId, {
      minIdleAgeMs: HUB_IDLE_MIN_AGE_MS,
    });
    if (!claim.ok) {
      return reply.code(400).send({
        error: claim.code,
        currentStatus: claim.currentStatus,
        idleAge: claim.idleAge,
      });
    }

    serverLog("info", "hub", "dispatch-to-idle 开始", {
      sessionId: targetSessionId,
      meta: {
        textPreview: cleanText.slice(0, 80),
        textLen: cleanText.length,
        idleAge: claim.idleAge,
      },
    });

    // 写 PTY
    const ok = ptyManager.write(targetSessionId, cleanText + "\r");
    if (!ok) {
      // 回滚 claim，让下次 hook 把它转回 idle 后能再次派
      statusManager.releaseIdleClaim(targetSessionId);
      serverLog("error", "hub", "dispatch-to-idle PTY 写入失败 (已回滚 claim)", {
        sessionId: targetSessionId,
        meta: { textPreview: cleanText.slice(0, 80) },
      });
      return reply.code(500).send({ error: "pty_write_failed" });
    }

    // 防下次立刻派 (Codex 第 7 点：hub 自己也算一次"最近输入")
    lastInputAt.set(targetSessionId, Date.now());

    const ms = Date.now() - t0;
    serverLog("info", "hub", `dispatch-to-idle 成功 (${ms}ms)`, {
      sessionId: targetSessionId,
      meta: {
        textPreview: cleanText.slice(0, 80),
        textLen: cleanText.length,
        idleAge: claim.idleAge,
      },
    });
    return reply.send({
      sessionId: targetSessionId,
      status: "working",
      idleAge: claim.idleAge,
    });
  });

  // 飞书桥：总控台 AI 调 send_feishu_message → 这里 → 发给大哥的飞书。
  app.post("/api/hub/send-feishu-message", async (req, reply) => {
    const parsed = SendFeishuSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const cleanText = sanitizeDispatchText(parsed.data.text).trim();
    if (cleanText.length === 0) {
      return reply.code(400).send({ error: "invalid_body", detail: "text empty after sanitize" });
    }
    try {
      await sendToOwner(cleanText);
      return reply.send({ ok: true });
    } catch (err) {
      const e = err as Error;
      // outbound 失败已在 sendToOwner 内打 ERROR；这里回结构化错误给 MCP 工具。
      return reply.code(502).send({ error: "feishu_send_failed", message: e.message });
    }
  });

  // 微信桥：总控台 AI 调 send_wechat_reply → 这里 → 回给微信里发问的 owner。
  // 只能回带 requestId 的当前待回复请求（串行单请求，防回错人）。
  app.post("/api/hub/send-wechat-reply", async (req, reply) => {
    const parsed = SendWechatReplySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const cleanText = sanitizeDispatchText(parsed.data.text).trim();
    if (cleanText.length === 0) {
      return reply.code(400).send({ error: "invalid_body", detail: "text empty after sanitize" });
    }
    try {
      await resolveWechatReply(parsed.data.requestId, cleanText);
      return reply.send({ ok: true });
    } catch (err) {
      const e = err as Error;
      // reply 失败已在 resolveWechatReply 内打 ERROR；这里回结构化错误给 MCP 工具。
      return reply.code(502).send({ error: "wechat_reply_failed", message: e.message });
    }
  });

  // 飞书桥：总控台替大哥把一句话写进某个 worker（仅当它正 waiting_input）。
  // 严格门禁——这是高风险工具：总控台可能被提示词诱导往任意终端乱写。
  app.post("/api/hub/send-input-to-session", async (req, reply) => {
    const parsed = SendInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { sessionId } = parsed.data;
    const cleanText = sanitizeDispatchText(parsed.data.text).trim();
    if (cleanText.length === 0) {
      return reply.code(400).send({ error: "invalid_body", detail: "text empty after sanitize" });
    }

    const row = getSession(sessionId);
    if (!row) return reply.code(404).send({ error: "session_not_found" });
    // 决不允许写总控台自己（这是 worker 控制工具，不是给 hub 自言自语）。
    if (row.projectId === HUB_PROJECT_ID) {
      return reply.code(400).send({ error: "cannot_target_hub" });
    }
    // 仅 AI 终端（claude/codex 有 waiting_input 语义），纯 shell 拒绝。
    if (SHELL_SET.has(row.agent)) {
      return reply.code(400).send({ error: "not_ai_session", currentAgent: row.agent });
    }
    if (!ptyManager.has(sessionId)) {
      return reply.code(400).send({ error: "no_live_pty" });
    }
    // 核心门禁：必须正在 waiting_input（worker 显式在等人回答）。
    const liveStatus = statusManager.get(sessionId);
    if (liveStatus !== "waiting_input") {
      return reply.code(400).send({ error: "not_waiting_input", currentStatus: liveStatus });
    }
    // 最近 1s 有人类网页输入 → 拒绝，防抢大哥正在敲的字。
    const lastIn = lastInputAt.get(sessionId);
    if (lastIn != null && Date.now() - lastIn < HUB_RECENT_INPUT_WINDOW_MS) {
      return reply.code(400).send({ error: "recently_typed", sinceMs: Date.now() - lastIn });
    }
    // 短锁：同一 worker 同时只允许一次 send-input 在飞行。
    if (sendInputLocks.has(sessionId)) {
      return reply.code(409).send({ error: "locked" });
    }
    sendInputLocks.add(sessionId);

    const t0 = Date.now();
    serverLog("info", "hub", "send-input 开始", {
      sessionId,
      meta: { textPreview: cleanText.slice(0, 80), textLen: cleanText.length },
    });
    try {
      const ok = ptyManager.write(sessionId, cleanText + "\r");
      if (!ok) {
        serverLog("error", "hub", "send-input PTY 写入失败", {
          sessionId,
          meta: { textPreview: cleanText.slice(0, 80) },
        });
        return reply.code(500).send({ error: "pty_write_failed" });
      }
      // hub 自己这次写也算"最近输入"，防紧接着再被诱导连发。
      lastInputAt.set(sessionId, Date.now());
      serverLog("info", "hub", `send-input 成功 (${Date.now() - t0}ms)`, {
        sessionId,
        meta: { textPreview: cleanText.slice(0, 80), textLen: cleanText.length },
      });
      return reply.send({ sessionId, written: true });
    } finally {
      sendInputLocks.delete(sessionId);
    }
  });

  // Recent PTY output for any session — used by MCP read_session_output so
  // hub claude can "see what that session is doing" after dispatching.
  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    "/api/hub/sessions/:id/recent-output",
    async (req, reply) => {
      const sid = req.params.id;
      // Confirm the row exists (also catches hibernated sessions whose PTY
      // may not be alive — buffer can still be empty in that case).
      const row = getSession(sid);
      if (!row) return reply.code(404).send({ error: "session_not_found" });
      const n = Math.max(1, Math.min(Number(req.query.lines ?? 200) || 200, 1000));
      const fullBuf = ptyManager.getBuffer(sid);
      // Tail by line count. pty-manager buffer is raw PTY text (may contain
      // ANSI sequences); we tail by '\n' boundaries — this gives roughly the
      // last N visible lines, which is what models expect.
      const lines = fullBuf.split("\n");
      const tail = lines.slice(-n).join("\n");
      return reply.send({
        sessionId: sid,
        agent: row.agent,
        status: row.status,
        linesRequested: n,
        linesReturned: Math.min(n, lines.length),
        bufferAlive: ptyManager.has(sid),
        content: tail,
      });
    },
  );
}
