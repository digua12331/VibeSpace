import { nanoid } from "nanoid";
import { createSession, listSessionsByProject, updateSessionPid, type Agent } from "../db.js";
import { ptyManager } from "../pty-manager.js";
import { statusManager } from "../status.js";
import { injectMcpForAgent } from "../mcp-bridge.js";
import { HUB_PROJECT_ID } from "../hub-project.js";
import { ensureHubWorkspace, getHubWorkspaceDir } from "../hub-workspace.js";
import { serverLog } from "../log-bus.js";

// The hub session the feishu bridge talks to. Module-level so we can tell a
// fresh spawn from a respawn-after-death (the latter loses conversation memory
// and warrants a「总控台已重启」notice to feishu).
let currentHubSessionId: string | null = null;

// Wired by feishu/index.ts → outbound. Kept as an injected hook to avoid a
// hub-session ↔ outbound import cycle. Null until outbound is wired (phase 2).
let restartNotifier: ((text: string) => void) | null = null;

export function setHubRestartNotifier(fn: (text: string) => void): void {
  restartNotifier = fn;
}

/** The live hub session id, or null if none is currently alive. */
export function getHubSessionId(): string | null {
  if (currentHubSessionId && ptyManager.has(currentHubSessionId)) return currentHubSessionId;
  return null;
}

/** An existing alive hub session (e.g. the user opened the 总控台 terminal manually). */
function findAliveHubSession(): string | null {
  for (const s of listSessionsByProject(HUB_PROJECT_ID)) {
    if (ptyManager.has(s.id)) return s.id;
  }
  return null;
}

/**
 * Guarantee a live 总控台 (hub) claude session exists, spawning one in the
 * `__hub__` project if needed. Reuses any alive hub session first. When a
 * previously-known hub session has died and we respawn, fire the restart
 * notifier so feishu warns the owner that memory was lost.
 *
 * Mirrors the core of routes/sessions.ts::startSession but skips the
 * HTTP-only concerns (worktree, skill injection, fastify reply). Agent is
 * forced to claude — the aimon-hub MCP tools are claude-only.
 */
export async function ensureHubSession(): Promise<{ sessionId: string; spawned: boolean }> {
  const alive = findAliveHubSession();
  if (alive) {
    currentHubSessionId = alive;
    return { sessionId: alive, spawned: false };
  }

  const isRestart = currentHubSessionId !== null; // we had one; it's gone now
  const agent: Agent = "claude";
  const t0 = Date.now();
  serverLog("info", "feishu", "hub-ensure 开始", {
    meta: { reason: isRestart ? "restart" : "spawn" },
  });
  try {
    ensureHubWorkspace();
    const sessionId = nanoid(16);
    const cwd = getHubWorkspaceDir();
    createSession({
      id: sessionId,
      projectId: HUB_PROJECT_ID,
      agent,
      status: "starting",
      pid: null,
      isolation: "shared",
      task: null,
    });
    statusManager.onSpawn(sessionId);
    // injectMcpForAgent routes __hub__ to injectHubMcps, writing
    // hub-workspace/.mcp.json with the aimon-hub MCP (token + backend port).
    await injectMcpForAgent(agent, cwd, sessionId, HUB_PROJECT_ID);
    const { pid } = ptyManager.spawn({ sessionId, agent, cwd, env: {} });
    updateSessionPid(sessionId, pid);
    currentHubSessionId = sessionId;
    serverLog("info", "feishu", `hub-ensure 成功 (${Date.now() - t0}ms)`, {
      sessionId,
      meta: { pid, agent, isRestart },
    });
    if (isRestart && restartNotifier) {
      try {
        restartNotifier("⚠️ 总控台已重启，之前的对话记忆可能丢失。");
      } catch {
        /* notifier failures are non-fatal */
      }
    }
    return { sessionId, spawned: true };
  } catch (err) {
    const e = err as Error;
    serverLog("error", "feishu", `hub-ensure 失败: ${e.message}`, {
      meta: { error: { name: e.name, message: e.message, stack: e.stack } },
    });
    throw e;
  }
}
