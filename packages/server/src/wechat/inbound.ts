import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { ptyManager } from "../pty-manager.js";
import { statusManager } from "../status.js";
import { serverLog } from "../log-bus.js";
import { ensureHubSession } from "../hub-session.js";
import { wechatClient, type WechatInboundMessage } from "./client.js";
import { getWechatConfig, setWechatConfig } from "./config.js";

/**
 * 微信入站闭环：绑定口令 → owner 白名单 → 串行单请求 → 写总控台 PTY。
 * 回复经 resolveWechatReply（routes/hub.ts 的 send-wechat-reply 调用）。
 * 运行态（绑定窗口、pending 请求）全内存，重启即丢——owner 重发即可。
 */

const MAX_TEXT_LEN = 8000; // 与飞书入站同上限
const HUB_READY_TIMEOUT_MS = 20000;
const HUB_READY_POLL_MS = 300;
const BINDING_WINDOW_MS = 2 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000; // 总控台一直不回则放行下一条
const REJECT_REPLY_COOLDOWN_MS = 60 * 1000; // 非 owner 的回绝提示限流

interface BindingWindow {
  code: string;
  expiresAt: number;
}

interface PendingRequest {
  requestId: string;
  fromUserId: string;
  contextToken: string;
  createdAt: number;
}

let binding: BindingWindow | null = null;
let pending: PendingRequest | null = null;
const rejectRepliedAt = new Map<string, number>();

// ---- 给 routes 用的查询/操作 ----------------------------------------------

/** 设置页点「开始绑定」：生成一次性 6 位口令，2 分钟窗口。 */
export function startBindingWindow(): { code: string; expiresAt: number } {
  binding = {
    code: String(randomInt(100000, 1000000)),
    expiresAt: Date.now() + BINDING_WINDOW_MS,
  };
  serverLog("info", "wechat", "bind 窗口开启（2 分钟）");
  return { code: binding.code, expiresAt: binding.expiresAt };
}

export function getBindingWindow(): { active: boolean; expiresAt: number | null } {
  if (!binding || Date.now() > binding.expiresAt) return { active: false, expiresAt: null };
  return { active: true, expiresAt: binding.expiresAt };
}

/** 「重置绑定」：清 owner，旧 owner 立即失效；需重新开窗绑定。 */
export function resetBinding(): void {
  binding = null;
  pending = null;
  setWechatConfig({ ownerUserId: "" });
  serverLog("info", "wechat", "bind 已重置（owner 清空）");
}

/**
 * 总控台 AI 调 send_wechat_reply → routes/hub.ts → 这里。按 requestId 对上
 * pending 才能发，发完清 pending（放行下一条）。
 */
export async function resolveWechatReply(requestId: string, text: string): Promise<void> {
  if (!pending || pending.requestId !== requestId) {
    throw new Error(
      pending
        ? `requestId 不匹配（当前待回复的是 ${pending.requestId}）`
        : "没有待回复的微信请求（可能已超时被放行，让 owner 重发一次）",
    );
  }
  const target = pending;
  const t0 = Date.now();
  serverLog("info", "wechat", "reply 开始", { meta: { requestId, len: text.length } });
  try {
    await wechatClient.sendReply(target.fromUserId, target.contextToken, text);
    pending = null;
    serverLog("info", "wechat", `reply 成功 (${Date.now() - t0}ms)`, { meta: { requestId } });
  } catch (err) {
    const e = err as Error;
    serverLog("error", "wechat", `reply 失败: ${e.message}`, {
      meta: { requestId, error: { name: e.name, message: e.message } },
    });
    throw e;
  }
}

// ---- 入站处理 ---------------------------------------------------------------

/**
 * C0 控制字符与 DEL 换空格，防多行粘贴提前回车/注入总控台 TUI。
 * （与 feishu/inbound.ts 同款的小工具，刻意各留一份避免跨通道 import。）
 */
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? " " : ch;
  }
  return out;
}

async function waitForHubReady(sessionId: string): Promise<boolean> {
  const deadline = Date.now() + HUB_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const st = statusManager.get(sessionId);
    if (st && st !== "starting") return true;
    await new Promise((r) => setTimeout(r, HUB_READY_POLL_MS));
  }
  return false;
}

/** 礼貌性回复：失败不影响主流程。 */
async function replyBestEffort(msg: WechatInboundMessage, text: string): Promise<void> {
  try {
    await wechatClient.sendReply(msg.fromUserId, msg.contextToken, text);
  } catch {
    /* courtesy reply must not break inbound */
  }
}

async function handleInbound(msg: WechatInboundMessage): Promise<void> {
  const cfg = getWechatConfig();
  const trimmed = (msg.text ?? "").trim();

  // 1) 绑定口令（窗口内任何人发对口令即绑定为 owner——窗口由设置页主动开启）
  if (binding && Date.now() <= binding.expiresAt && trimmed === binding.code) {
    binding = null;
    setWechatConfig({ ownerUserId: msg.fromUserId });
    serverLog("info", "wechat", "bind 成功", { meta: { ownerUserId: msg.fromUserId } });
    await replyBestEffort(msg, "✅ 绑定成功。现在可以直接发话给总控台 AI 了（一次一问，回答会回到这里）。");
    return;
  }

  // 2) owner 白名单（未绑定 / 非 owner 一律不进总控台；回绝提示限流防风暴）
  if (!cfg.ownerUserId || msg.fromUserId !== cfg.ownerUserId) {
    const last = rejectRepliedAt.get(msg.fromUserId);
    if (last === undefined || Date.now() - last > REJECT_REPLY_COOLDOWN_MS) {
      rejectRepliedAt.set(msg.fromUserId, Date.now());
      serverLog("warn", "wechat", "inbound 拒绝: 非绑定 owner", { meta: { fromUserId: msg.fromUserId } });
      await replyBestEffort(
        msg,
        cfg.ownerUserId
          ? "⛔ 无权限：这个机器人只听绑定的主人的话。"
          : "⛔ 尚未绑定：请在 VibeSpace 设置 → 微信机器人里点「开始绑定」，再把口令发给我。",
      );
    }
    return;
  }

  // 3) 非文本不进总控台（游标照常推进——由 client 的循环统一提交）
  const text = stripControls(trimmed).slice(0, MAX_TEXT_LEN).trim();
  if (!text) {
    await replyBestEffort(msg, "暂不支持该消息类型，请发纯文本。");
    return;
  }

  // 4) 串行单请求：有 pending 时拒绝新消息（超时的 pending 放行）
  if (pending && Date.now() - pending.createdAt > PENDING_TTL_MS) {
    serverLog("warn", "wechat", "pending 超时放行", { meta: { requestId: pending.requestId } });
    pending = null;
  }
  if (pending) {
    await replyBestEffort(msg, "⏳ 上一条还在处理中，等回复到了再发下一条。");
    return;
  }

  // 5) 写入总控台
  const requestId = nanoid(8);
  pending = { requestId, fromUserId: msg.fromUserId, contextToken: msg.contextToken, createdAt: Date.now() };
  const t0 = Date.now();
  serverLog("info", "wechat", "inbound 开始", { meta: { requestId, len: text.length } });
  try {
    const { sessionId, spawned } = await ensureHubSession();
    if (spawned) {
      const ready = await waitForHubReady(sessionId);
      if (!ready) {
        serverLog("warn", "wechat", "inbound 总控台就绪超时，仍尝试写入", { sessionId });
      }
    }
    const ok = ptyManager.write(sessionId, `[微信 requestId=${requestId}] ${text}\r`);
    if (!ok) throw new Error("总控台 PTY 写入失败（会话可能已退出）");
    serverLog("info", "wechat", `inbound 成功 (${Date.now() - t0}ms)`, {
      sessionId,
      meta: { requestId, spawned, len: text.length },
    });
  } catch (err) {
    pending = null; // 没进总控台就不占串行槽
    const e = err as Error;
    serverLog("error", "wechat", `inbound 失败: ${e.message}`, {
      meta: { requestId, error: { name: e.name, message: e.message, stack: e.stack } },
    });
    await replyBestEffort(msg, `⚠️ 转给总控台失败：${e.message}`);
  }
}

/** Wire the inbound handler onto the wechat client. Called once at bridge start. */
export function registerWechatInbound(): void {
  wechatClient.setMessageHandler((msg) => handleInbound(msg));
}
