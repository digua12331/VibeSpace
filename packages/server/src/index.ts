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
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerPerfRoutes } from "./routes/perf.js";
import { registerFsOpsRoutes } from "./routes/fs-ops.js";
import { registerPasteImageRoutes } from "./routes/paste-image.js";
import { registerOutputRoutes } from "./routes/output.js";
import { registerRawFileRoutes } from "./routes/raw-file.js";
import { registerJobsRoutes } from "./routes/jobs.js";
import { registerSubagentRunsRoutes } from "./routes/subagent-runs.js";
import { registerUsageRoutes } from "./routes/usage.js";
import { registerSkillCatalogRoutes } from "./routes/skill-catalog.js";
import { registerSkillMarketRoutes } from "./routes/skill-market.js";
import { registerSlashCommandRoutes } from "./routes/slash-commands.js";
import { installClaudeHooks } from "./hook-installer.js";

const PORT = Number(process.env.AIMON_PORT || 8787);
const HOST = "127.0.0.1";

async function main(): Promise<void> {
  getDb();

  // Reap orphans: any session left with ended_at = null from a previous boot
  // can never come back to life (its PTY died with the parent). Mark them
  // stopped so the front-end's "alive" filter is meaningful again.
  try {
    let reaped = 0;
    for (const s of listSessions()) {
      if (s.endedAt == null) {
        endSession(s.id, "stopped", null);
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
  });
  ptyManager.on(
    "exit",
    (sessionId: string, code: number | null, signal: number | null, wasKilled: boolean) => {
      codexDetector.onExit(sessionId);
      agentCache.delete(sessionId);
      statusManager.onExit(sessionId, code, signal, wasKilled);
      const status: SessionStatus = wasKilled ? "stopped" : (code === 0 ? "stopped" : "crashed");
      try {
        endSession(sessionId, status, code);
      } catch (err) {
        app.log.error({ err, sessionId }, "failed to mark session ended");
      }
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
  await registerMemoryRoutes(app);
  await registerPerfRoutes(app);
  await registerFsOpsRoutes(app);
  await registerPasteImageRoutes(app);
  await registerOutputRoutes(app);
  await registerRawFileRoutes(app);
  await registerJobsRoutes(app);
  await registerSubagentRunsRoutes(app);
  await registerUsageRoutes(app);
  await registerSkillCatalogRoutes(app);
  await registerSkillMarketRoutes(app);
  await registerSlashCommandRoutes(app);
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
  // Keep these two as plain console.log — they're startup-only path hints
  // for the operator, not operation events that need to reach LogsView.
  console.log(`VibeSpace db: ${getDbPath()}`);
  console.log(`VibeSpace projects.json: ${getProjectsJsonPath()}`);

  let shuttingDown = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ sig }, "shutting down");
    try {
      for (const s of listSessions()) {
        if (ptyManager.has(s.id)) {
          try { endSession(s.id, "stopped", null); } catch { /* ignore */ }
          ptyManager.kill(s.id);
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

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
