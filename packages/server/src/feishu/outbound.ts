import {
  BUILTIN_SHELL_AGENTS,
  getProject,
  getSession,
  type SessionStatus,
} from "../db.js";
import { HUB_PROJECT_ID } from "../hub-project.js";
import { statusManager } from "../status.js";
import { serverLog } from "../log-bus.js";
import { feishuClient } from "./client.js";
import { getFeishuConfig, isFeishuConfigured } from "./config.js";
import { setHubRestartNotifier } from "./hub-session.js";

const SHELL_AGENTS = new Set<string>(BUILTIN_SHELL_AGENTS);
// 同一 session 同一状态在窗口内只通知一次，避免刷屏。
const NOTIFY_DEDUP_MS = 30_000;

/**
 * Proactively send a plain-text message to the configured owner (大哥). Used by
 * the `send_feishu_message` MCP tool (the 总控台 talking to you), the
 * hub-restart notice, and worker notifications (phase 3). Throws on failure so
 * callers can surface an outbound ERROR.
 */
export async function sendToOwner(text: string): Promise<void> {
  const cfg = getFeishuConfig();
  if (!cfg.ownerOpenId) {
    throw new Error("未配置接收人 open_id（在设置 → 飞书填『你的 open_id』）");
  }
  const t0 = Date.now();
  serverLog("info", "feishu", "outbound 开始", { meta: { len: text.length } });
  try {
    await feishuClient.sendText(cfg.ownerOpenId, "open_id", text);
    serverLog("info", "feishu", `outbound 成功 (${Date.now() - t0}ms)`, {
      meta: { len: text.length },
    });
  } catch (err) {
    const e = err as Error;
    serverLog("error", "feishu", `outbound 失败: ${e.message}`, {
      meta: { error: { name: e.name, message: e.message, stack: e.stack } },
    });
    throw e;
  }
}

// ---- Worker（非总控台干活终端）状态汇聚 → 飞书系统通知 ----

// 上一次见到的状态（用于识别 working→idle = 任务完成）。
const lastStatus = new Map<string, SessionStatus>();
// (sessionId:status) → 上次通知时间，用于限流去重。
const lastNotifyAt = new Map<string, number>();

/** Build the feishu notice for a worker status, or null if this transition isn't worth notifying. */
function workerNotice(
  taskLabel: string,
  status: SessionStatus,
  prev: SessionStatus | undefined,
): string | null {
  const tail = "（要操作请对总控台说『回复任务" + taskLabel + "：…』）";
  switch (status) {
    case "waiting_input":
      return `⚙️ 任务「${taskLabel}」需要你拿主意。\n${tail}`;
    case "idle":
      // idle ≠ 一定成功；只在 working→idle 这次跳变当作「干完一轮」通知。
      return prev === "working" ? `✅ 任务「${taskLabel}」告一段落（已空闲）。\n${tail}` : null;
    case "crashed":
      return `⚠️ 任务「${taskLabel}」异常结束（进程崩溃）。`;
    case "stopped":
      return `🛑 任务「${taskLabel}」已停止。`;
    default:
      return null;
  }
}

function onWorkerStatusChange(sessionId: string, status: SessionStatus): void {
  const prev = lastStatus.get(sessionId);
  lastStatus.set(sessionId, status);

  const cfg = getFeishuConfig();
  if (!isFeishuConfigured(cfg) || !cfg.ownerOpenId) return;

  const row = getSession(sessionId);
  if (!row) return;
  if (row.projectId === HUB_PROJECT_ID) return; // 总控台自己不算 worker
  if (SHELL_AGENTS.has(row.agent)) return; // 纯 shell 不通知

  const notice = workerNotice(row.task ?? sessionId.slice(0, 6), status, prev);
  if (!notice) return;

  // 限流去重：同 session 同状态 30s 内只发一条。
  const key = `${sessionId}:${status}`;
  const now = Date.now();
  const last = lastNotifyAt.get(key);
  if (last != null && now - last < NOTIFY_DEDUP_MS) return;
  lastNotifyAt.set(key, now);

  const t0 = Date.now();
  serverLog("info", "feishu", "notify 开始", {
    sessionId,
    meta: { status, task: row.task },
  });
  void sendToOwner(notice)
    .then(() => {
      serverLog("info", "feishu", `notify 成功 (${Date.now() - t0}ms)`, {
        sessionId,
        meta: { status },
      });
    })
    .catch(() => {
      // sendToOwner 已打 outbound ERROR；这里再补一条 notify 失败便于按 action 过滤。
      serverLog("error", "feishu", "notify 失败（详见同期 outbound ERROR）", {
        sessionId,
        meta: { status },
      });
    });
}

/**
 * Wire outbound side-effects at bridge start:
 *  - the hub-restart notice (总控台 memory loss warning) goes to the owner;
 *  - non-hub worker sessions reaching waiting_input / 完成 / 异常 → feishu notice.
 */
export function registerOutbound(): void {
  setHubRestartNotifier((text) => {
    void sendToOwner(text).catch(() => {
      /* restart notice is best-effort; sendToOwner already logged the error */
    });
  });
  statusManager.on("change", (sessionId: string, status: SessionStatus) => {
    try {
      onWorkerStatusChange(sessionId, status);
    } catch {
      /* a notify failure must never destabilize the status machine */
    }
  });
}
