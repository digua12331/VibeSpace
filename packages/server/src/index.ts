import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyWebsocket from "@fastify/websocket";
import {
  closeDb,
  endSession,
  getDb,
  getDbPath,
  getProjectsJsonPath,
  getSession,
  listSessions,
  updateSessionStatus,
  type Agent as SessionRowAgent,
  type SessionStatus,
} from "./db.js";
import { ptyManager } from "./pty-manager.js";
import { statusManager } from "./status.js";
import { CodexStatusDetector } from "./codex-status.js";
import { registerWsHub, SERVER_VERSION } from "./ws-hub.js";
import { pruneOldLogs, serverLog } from "./log-bus.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerHookRoutes } from "./routes/hooks.js";
import { registerCliConfigRoutes } from "./routes/cli-configs.js";
import { registerCliInstallerRoutes } from "./routes/cli-installer.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerDocsRoutes } from "./routes/docs.js";
import { registerCommentsRoutes } from "./routes/comments.js";
import { registerIssuesRoutes } from "./routes/issues.js";
import { registerIssueJobsRoutes } from "./routes/issue-jobs.js";
import { registerTaskBudgetRoutes } from "./routes/task-budget.js";
import { registerTaskSubtaskRoutes } from "./routes/task-subtasks.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerFsOpsRoutes } from "./routes/fs-ops.js";
import { registerPasteImageRoutes } from "./routes/paste-image.js";
import { registerProjectDocsRoutes } from "./routes/project-docs.js";
import { registerRawFileRoutes } from "./routes/raw-file.js";
import { registerSubagentRunsRoutes } from "./routes/subagent-runs.js";
import { registerSkillCatalogRoutes } from "./routes/skill-catalog.js";
import { registerSkillMarketRoutes } from "./routes/skill-market.js";
import { registerSlashCommandRoutes } from "./routes/slash-commands.js";
import { registerOpenspecRoutes } from "./routes/openspec.js";
import { registerExternalToolsRoutes } from "./routes/external-tools.js";
import { registerAppSettingsRoutes } from "./routes/app-settings.js";
import { registerClaudeSettingsRoutes } from "./routes/claude-settings.js";
import { registerProjectClaudeSettingsRoutes } from "./routes/project-claude-settings.js";
import { registerMcpServersRoutes } from "./routes/mcp-servers.js";
import { registerHubRoutes } from "./routes/hub.js";
import { registerFeishuRoutes } from "./routes/feishu.js";
import { startFeishuBridge } from "./feishu/index.js";
import { getHubToken } from "./hub-token.js";
import { ensureHubWorkspace } from "./hub-workspace.js";
import { ensureHubProject } from "./hub-project.js";
import { startHibernateSweeper } from "./hibernate-sweeper.js";
import {
  startProcessMemTicker,
  stopProcessMemTicker,
} from "./process-mem-service.js";
import { pruneOldPastedImages } from "./paste-image-cleaner.js";
import { installClaudeHooks } from "./hook-installer.js";

const PORT = Number(process.env.AIMON_PORT || 8787);
const HOST = "127.0.0.1";

async function main(): Promise<void> {
  // D1 翻转 (总控台体验对齐 plan)：必须在第一次 getDb() / syncProjectsTable
  // 之前确保 __hub__ 系统项目在 projects.json 里——否则 DB 同步发现 __hub__
  // 不在 JSON 里会 ON DELETE CASCADE 删 hub sessions (Codex 第 1 点警告)。
  ensureHubProject();

  getDb();

  // Reap orphans: any session left with ended_at = null from a previous boot
  // whose PTY can never come back. Mark them stopped so the front-end's "alive"
  // filter is meaningful again. Hibernated rows are exempt — they intentionally
  // outlive the parent process and are revived via POST /api/sessions/:id/wake.
  try {
    let reaped = 0;
    for (const s of listSessions()) {
      if (s.endedAt == null && s.status !== "hibernated") {
        endSession(s.id, "stopped", null);
        serverLog("warn", "session", "close (orphan-reap)", {
          projectId: s.projectId,
          sessionId: s.id,
          meta: {
            agent: s.agent,
            previousStatus: s.status,
            reason: "orphan-reap",
          },
        });
        reaped += 1;
      }
    }
    if (reaped > 0) console.log(`VibeSpace: reaped ${reaped} orphan session(s) from previous run`);
  } catch (err) {
    console.warn("VibeSpace: orphan reap failed:", (err as Error).message);
  }

  if (process.env.AIMON_SKIP_HOOK_INSTALL) {
    console.log("aimon hook install: skipped (AIMON_SKIP_HOOK_INSTALL=1)");
  } else {
    try {
      const r = installClaudeHooks();
      if (r.status === "failed") {
        console.warn(`aimon hook install: WARN ${r.error ?? "unknown"} (path=${r.settingsPath})`);
      } else {
        console.log(
          `aimon hook install: ${r.status} (path=${r.settingsPath}, changed=[${r.changed.join(",")}])`,
        );
      }
    } catch (err) {
      console.warn("aimon hook install: WARN", (err as Error).message);
    }
  }

  const app = Fastify({ logger: { level: "info" } });

  const corsOrigins = (process.env.AIMON_WEB_ORIGIN
    ? process.env.AIMON_WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
    : ["http://127.0.0.1:8788", "http://localhost:8788"]);
  await app.register(fastifyCors, {
    origin: corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  await app.register(fastifyWebsocket);

  // ---- /api/hub/* 鉴权 ----
  // 防多 VibeSpace 实例 (dev 9787 / stable 8787) 同机时 hub MCP server 子进程
  // 误连错 backend。规则：
  //   header X-Hub-Token == 当前 getHubToken() → 放行
  //   未带 token 但 req.ip 是 loopback (127.0.0.1 / ::1 / ::ffff:127.0.0.1) → 放行
  //     (浏览器 UI 不需要 token，因为它本来就在用户机器上)
  //   其它 → 401
  // 不是为防本机恶意用户；本地单用户场景下没有完整鉴权需求。
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/hub/")) return;
    const presented = req.headers["x-hub-token"];
    // 客户端显式带了 token → 必须校验通过；不能 fallback 到 loopback 放行，
    // 否则 token 写错就完全没人提醒。
    if (typeof presented === "string") {
      if (presented === getHubToken()) return;
      serverLog("warn", "hub", "unauthorized /api/hub/* 请求 (token 错误)", {
        meta: { ip: req.ip ?? "", url: req.url },
      });
      return reply.code(401).send({ error: "unauthorized" });
    }
    // 无 token → 仅本机 loopback 放行（浏览器 UI 走这条）
    const ip = req.ip ?? "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return;
    serverLog("warn", "hub", "unauthorized /api/hub/* 请求 (非 loopback 且无 token)", {
      meta: { ip, url: req.url },
    });
    return reply.code(401).send({ error: "unauthorized" });
  });

  // hub workspace 一次性初始化（mkdir + README）。.mcp.json 留待
  // hub-session-runtime 启动每个 hub session 时再写（含当时 token + port）。
  ensureHubWorkspace();

  // ---- wire PTY events ----
  // In-process agent cache so the heuristic detector doesn't hit SQLite per chunk.
  const agentCache = new Map<string, SessionRowAgent>();
  const codexDetector = new CodexStatusDetector(statusManager, (sid) => {
    const cached = agentCache.get(sid);
    if (cached) return cached;
    const row = getSession(sid);
    if (row?.agent) {
      agentCache.set(sid, row.agent);
      return row.agent;
    }
    return undefined;
  });

  ptyManager.on("output", (sessionId: string, chunk: string) => {
    statusManager.onData(sessionId, chunk);
    codexDetector.onData(sessionId, chunk);
    recordPtyChunk(sessionId, chunk);
  });
  ptyManager.on(
    "exit",
    (
      sessionId: string,
      code: number | null,
      signal: number | null,
      wasKilled: boolean,
      killReason: string | null,
    ) => {
      codexDetector.onExit(sessionId);
      agentCache.delete(sessionId);
      // If the sweeper marked this row hibernated before killing the PTY,
      // hibernate-sweeper has already written status='hibernated' and pid=NULL.
      // Skip the normal endSession / status-machine bookkeeping so ended_at
      // stays NULL (the tab must keep showing in the UI for wake to work).
      // The sweeper also already logged hibernate-auto start/success — don't
      // emit a duplicate close entry here.
      const row = getSession(sessionId);
      if (row?.hibernatedAt != null) return;
      statusManager.onExit(sessionId, code, signal, wasKilled);
      const status: SessionStatus = wasKilled ? "stopped" : (code === 0 ? "stopped" : "crashed");
      try {
        endSession(sessionId, status, code);
      } catch (err) {
        app.log.error({ err, sessionId }, "failed to mark session ended");
      }
      // ---- Unified close-reason log ----
      // Decide a single reason tag for LogsView and the daily JSONL file so
      // the user can tell whether a tab disappeared because the CLI quit, it
      // crashed, they pressed stop, the OS killed it, etc.
      let closeReason: string;
      let level: "info" | "warn" | "error";
      if (wasKilled) {
        closeReason = killReason ?? "killed-unknown";
        level = closeReason === "killed-unknown" || closeReason === "budget-cutoff"
          ? "warn"
          : "info";
      } else if (signal != null) {
        closeReason = `os-signal-${signal}`;
        level = "error";
      } else if (code === 0) {
        closeReason = "cli-exit";
        level = "info";
      } else {
        closeReason = "crashed";
        level = "error";
      }
      serverLog(level, "session", `close (${closeReason})`, {
        projectId: row?.projectId,
        sessionId,
        meta: {
          agent: row?.agent,
          exitCode: code,
          signal,
          wasKilled,
          reason: closeReason,
        },
      });
    },
  );

  // status changes (other than the final exit row, which already wrote ended_at)
  statusManager.on(
    "change",
    (sessionId: string, status: SessionStatus) => {
      if (status === "stopped" || status === "crashed") return;
      try {
        updateSessionStatus(sessionId, status);
      } catch (err) {
        app.log.error({ err, sessionId, status }, "failed to update session status");
      }
    },
  );

  // ---- routes & ws ----
  await registerHealthRoutes(app);
  await registerProjectRoutes(app);
  await registerSessionRoutes(app);
  await registerHookRoutes(app);
  await registerCliConfigRoutes(app);
  await registerCliInstallerRoutes(app);
  await registerGitRoutes(app);
  await registerDocsRoutes(app);
  await registerCommentsRoutes(app);
  await registerIssuesRoutes(app);
  await registerIssueJobsRoutes(app);
  await registerTaskBudgetRoutes(app);
  await registerTaskSubtaskRoutes(app);
  await registerMemoryRoutes(app);
  await registerFsOpsRoutes(app);
  await registerPasteImageRoutes(app);
  await registerProjectDocsRoutes(app);
  await registerRawFileRoutes(app);
  await registerSubagentRunsRoutes(app);
  await registerSkillCatalogRoutes(app);
  await registerSkillMarketRoutes(app);
  await registerSlashCommandRoutes(app);
  await registerOpenspecRoutes(app);
  await registerExternalToolsRoutes(app);
  await registerAppSettingsRoutes(app);
  await registerClaudeSettingsRoutes(app);
  await registerProjectClaudeSettingsRoutes(app);
  await registerMcpServersRoutes(app);
  await registerHubRoutes(app);
  await registerFeishuRoutes(app);
  registerWsHub(app);

  await app.listen({ port: PORT, host: HOST });
  serverLog(
    "info",
    "server",
    `backend listening on http://${HOST}:${PORT}`,
    { meta: { version: SERVER_VERSION, host: HOST, port: PORT } },
  );
  // Janitorial: prune log files older than 30 days. Fire-and-forget so a slow
  // FS doesn't keep listen() from completing.
  void pruneOldLogs();
  // Prune pasted images per the user-configured retention. Same fire-and-forget
  // discipline — failures land in LogsView, never block startup.
  void pruneOldPastedImages();
  // Idle-session hibernation sweeper. Ticks every 30s; reads app-settings
  // each tick so flipping the master switch in SettingsDialog takes effect
  // without a restart.
  startHibernateSweeper();
  // 项目级 AI 终端内存占用 ticker：每 10s 一次 CIM 快照，按项目 broadcast
  // mem-stats。前端 ProjectsColumn 渲染到每行末尾。详见 process-mem-service.ts。
  startProcessMemTicker();
  // 诊断埋点：每 30s 打印 PTY 吞吐 + 进程内存，定位 "多终端长跑 OOM" 是不是
  // native 侧 external/rss 持续上涨。LogsView 看 scope=pty-stats。
  startPtyStatsLogger();
  // 飞书双向桥：fire-and-forget 拉起长连接（未配置时内部直接 no-op）。失败只落
  // LogsView，绝不阻塞服务启动——桥是可选能力。
  void startFeishuBridge();
  // Keep these two as plain console.log — they're startup-only path hints
  // for the operator, not operation events that need to reach LogsView.
  console.log(`VibeSpace db: ${getDbPath()}`);
  console.log(`VibeSpace projects.json: ${getProjectsJsonPath()}`);

  let shuttingDown = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ sig }, "shutting down");
    serverLog("info", "server", "shutdown 开始", { meta: { sig } });
    try {
      stopProcessMemTicker();
      for (const s of listSessions()) {
        if (ptyManager.has(s.id)) {
          try { endSession(s.id, "stopped", null); } catch { /* ignore */ }
          ptyManager.kill(s.id, "server-shutdown");
        }
      }
      await app.close();
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
    } finally {
      try { closeDb(); } catch { /* ignore */ }
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// ---------- PTY 吞吐 + 进程内存诊断埋点 ----------
// 用于排查 "多个 claude 终端长跑后 server OOM (Fatal process out of memory: Zone)"。
// 主要看：external / arrayBuffers / rss 是否随时间持续上涨（指向 node-pty native
// 侧的内存累积）。窗口口径 30s，与 hibernate-sweeper 对齐方便交叉对比。

interface PtySessionStats {
  agent: string;
  bytesTotal: number;
  chunksTotal: number;
  bytesWindow: number;
  chunksWindow: number;
}

const PTY_STATS_WINDOW_MS = 30_000;
const PTY_STATS_TOP_N = 10;
const ptyStatsStartedAt = Date.now();
let ptyBytesTotal = 0;
let ptyChunksTotal = 0;
let ptyBytesWindow = 0;
let ptyChunksWindow = 0;
const ptyPerSession = new Map<string, PtySessionStats>();

function recordPtyChunk(sessionId: string, chunk: string): void {
  const bytes = Buffer.byteLength(chunk, "utf8");
  ptyBytesTotal += bytes;
  ptyBytesWindow += bytes;
  ptyChunksTotal += 1;
  ptyChunksWindow += 1;
  let s = ptyPerSession.get(sessionId);
  if (!s) {
    const row = getSession(sessionId);
    s = {
      agent: row?.agent ?? "unknown",
      bytesTotal: 0,
      chunksTotal: 0,
      bytesWindow: 0,
      chunksWindow: 0,
    };
    ptyPerSession.set(sessionId, s);
  }
  s.bytesTotal += bytes;
  s.bytesWindow += bytes;
  s.chunksTotal += 1;
  s.chunksWindow += 1;
}

function startPtyStatsLogger(): void {
  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const alive = new Set(ptyManager.listAlive());
    // 只保留还活着的 session 累计；进程长跑时已退出 session 的 totals 没人看，
    // 留在 map 里只会拖大日志体积。
    for (const id of [...ptyPerSession.keys()]) {
      if (!alive.has(id)) ptyPerSession.delete(id);
    }
    const all = [...ptyPerSession.entries()].map(([id, s]) => ({
      id,
      agent: s.agent,
      bytesWindow: s.bytesWindow,
      chunksWindow: s.chunksWindow,
      bytesTotal: s.bytesTotal,
      chunksTotal: s.chunksTotal,
    }));
    all.sort((a, b) => b.bytesWindow - a.bytesWindow);
    const top = all.slice(0, PTY_STATS_TOP_N);
    const restCount = all.length - top.length;
    const restBytesWindow = all.slice(PTY_STATS_TOP_N).reduce((a, b) => a + b.bytesWindow, 0);
    const restChunksWindow = all.slice(PTY_STATS_TOP_N).reduce((a, b) => a + b.chunksWindow, 0);

    serverLog("info", "pty-stats", "30s 窗口 PTY 吞吐 + 进程内存", {
      meta: {
        uptimeMs: Date.now() - ptyStatsStartedAt,
        aliveCount: alive.size,
        windowMs: PTY_STATS_WINDOW_MS,
        windowBytes: ptyBytesWindow,
        windowChunks: ptyChunksWindow,
        totalBytes: ptyBytesTotal,
        totalChunks: ptyChunksTotal,
        mem: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers,
        },
        topSessions: top,
        restCount,
        restBytesWindow,
        restChunksWindow,
      },
    });

    // 重置窗口计数，累计不动
    ptyBytesWindow = 0;
    ptyChunksWindow = 0;
    for (const s of ptyPerSession.values()) {
      s.bytesWindow = 0;
      s.chunksWindow = 0;
    }
  }, PTY_STATS_WINDOW_MS);
  timer.unref();
  serverLog("info", "pty-stats", "诊断埋点已启用", {
    meta: { windowMs: PTY_STATS_WINDOW_MS, topN: PTY_STATS_TOP_N },
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
