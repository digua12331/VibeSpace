import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { statusManager } from "../status.js";
import { serverLog } from "../log-bus.js";
import { feishuClient, type FeishuInboundMessage } from "./client.js";
import { getFeishuConfig, isSenderAllowed } from "./config.js";
import { ensureHubSession, writeHubInput } from "../hub-session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = resolve(SERVER_ROOT, "data");
const SEEN_PATH = resolve(DATA_DIR, "feishu-seen.json");

// 飞书事件「至少投递一次」→ 按 event_id 幂等去重，落盘以便重启后短期不重复写。
const SEEN_TTL_MS = 10 * 60 * 1000; // 10 分钟够覆盖飞书重投窗口
const MAX_TEXT_LEN = 8000; // 写进总控台前的长度上限
const HUB_READY_TIMEOUT_MS = 20000; // 冷启动总控台后等它离开 starting 的上限
const HUB_READY_POLL_MS = 300;

let seen: Record<string, number> = loadSeen();

function loadSeen(): Record<string, number> {
  if (!existsSync(SEEN_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(SEEN_PATH, "utf8")) as Record<string, number>;
    const now = Date.now();
    const fresh: Record<string, number> = {};
    for (const [id, ts] of Object.entries(raw)) {
      if (typeof ts === "number" && now - ts < SEEN_TTL_MS) fresh[id] = ts;
    }
    return fresh;
  } catch {
    return {};
  }
}

function persistSeen(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${SEEN_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(seen), "utf8");
    renameSync(tmp, SEEN_PATH);
  } catch {
    /* dedup persistence is best-effort */
  }
}

/** Returns true if this event was already handled. Records it otherwise. */
function alreadySeen(eventId: string): boolean {
  const now = Date.now();
  // opportunistic prune
  for (const [id, ts] of Object.entries(seen)) {
    if (now - ts >= SEEN_TTL_MS) delete seen[id];
  }
  if (seen[eventId]) return true;
  seen[eventId] = now;
  persistSeen();
  return false;
}

/**
 * Replace every C0 control char (< 0x20) and DEL (0x7F) with a space, so a
 * pasted multi-line message can't prematurely submit or inject into the hub
 * TUI. We append the single CR ourselves at write time. Codepoint-based on
 * purpose — keeps literal control bytes out of the source.
 */
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  return out;
}

/**
 * Feishu text message content is a JSON string like `{"text":"@_user_1 hi"}`.
 * Pull out the plain text, strip @mention placeholders, control chars, and cap
 * length. Returns "" for unsupported message types (caller replies「暂不支持」).
 */
function extractPlainText(msg: FeishuInboundMessage): string {
  if (msg.messageType !== "text") return "";
  let text = "";
  try {
    const parsed = JSON.parse(msg.content) as { text?: string };
    text = typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
  text = text.replace(/@_user_\d+/g, "").replace(/@_all/g, "");
  text = stripControls(text).trim();
  if (text.length > MAX_TEXT_LEN) text = text.slice(0, MAX_TEXT_LEN);
  return text;
}

/** Wait until the hub session leaves 'starting' (claude TUI booting), or time out. */
async function waitForHubReady(sessionId: string): Promise<boolean> {
  const deadline = Date.now() + HUB_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const st = statusManager.get(sessionId);
    if (st && st !== "starting") return true;
    await new Promise((r) => setTimeout(r, HUB_READY_POLL_MS));
  }
  return false;
}

/** Reply to the sender (private → open_id, group → chat_id). Swallows errors. */
async function replyToSender(msg: FeishuInboundMessage, text: string): Promise<void> {
  try {
    if (msg.chatType === "p2p" && msg.openId) {
      await feishuClient.sendText(msg.openId, "open_id", text);
    } else {
      await feishuClient.sendText(msg.chatId, "chat_id", text);
    }
  } catch {
    /* a failed courtesy reply must not break inbound */
  }
}

async function handleInbound(msg: FeishuInboundMessage): Promise<void> {
  if (alreadySeen(msg.eventId)) return; // 幂等：重投直接丢弃，不记日志避免风暴

  const cfg = getFeishuConfig();
  // 白名单校验（私聊 open_id / 群 chat_id 分判，空名单全拒）
  if (!isSenderAllowed(cfg, msg.chatType, msg.openId, msg.chatId)) {
    serverLog("warn", "feishu", "inbound 拒绝: 不在白名单", {
      meta: { chatType: msg.chatType, openId: msg.openId, chatId: msg.chatId },
    });
    await replyToSender(msg, "⛔ 无权限：你的飞书账号不在总控台白名单里。");
    return;
  }

  const text = extractPlainText(msg);
  if (!text) {
    await replyToSender(msg, "暂不支持该消息类型，请发纯文本。");
    return;
  }

  const startedAt = Date.now();
  serverLog("info", "feishu", "inbound 开始", {
    meta: { chatType: msg.chatType, len: text.length },
  });
  try {
    const { sessionId, spawned } = await ensureHubSession();
    if (spawned) {
      const ready = await waitForHubReady(sessionId);
      if (!ready) {
        serverLog("warn", "feishu", "inbound 总控台就绪超时，仍尝试写入", { sessionId });
      }
    }
    const ok = await writeHubInput(sessionId, text);
    if (!ok) throw new Error("总控台 PTY 写入失败（会话可能已退出）");
    serverLog("info", "feishu", `inbound 成功 (${Date.now() - startedAt}ms)`, {
      sessionId,
      meta: { spawned, len: text.length },
    });
  } catch (err) {
    const e = err as Error;
    serverLog("error", "feishu", `inbound 失败: ${e.message}`, {
      meta: { error: { name: e.name, message: e.message, stack: e.stack } },
    });
    await replyToSender(msg, `⚠️ 转给总控台失败：${e.message}`);
  }
}

/** Wire the inbound handler onto the feishu transport. Called once at bridge start. */
export function registerInbound(): void {
  feishuClient.setMessageHandler((msg) => handleInbound(msg));
}
