import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { statusManager } from "../status.js";
import { serverLog } from "../log-bus.js";
import { ensureHubSession, getHubSessionId, writeHubInput } from "../hub-session.js";
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
const PENDING_TTL_MS = 10 * 60 * 1000; // 终极兜底：总控台一直不回则放行下一条
const REJECT_REPLY_COOLDOWN_MS = 60 * 1000; // 非 owner 的回绝提示限流
// 单飞锁逃生：总控台答完转 idle（或转去等终端输入）但没回传时，pending 会卡死后续
// 所有消息。给宽限期后判定为「孤儿请求」自动放行——覆盖 Claude Stop hook 异步滞后
// （status.ts 注释 D2≈800ms），8s 留足余量，避免把"刚好瞬时 idle"误判。
const ORPHAN_IDLE_GRACE_MS = 8000;
// owner 主动解锁的逃生指令（整条等于其一才触发，避免"取消订阅"这类误判）。
const CANCEL_WORDS = new Set(["取消", "重置", "解锁", "清空", "/cancel", "/reset", "/clear"]);

// ---- 纯判定逻辑（无副作用，供入站流程与冒烟测试共用）----------------------

/** 整条消息是否为逃生解锁指令。 */
export function isCancelWord(text: string): boolean {
  return CANCEL_WORDS.has(text.trim());
}

/**
 * 单飞闸口判定：给定 pending 年龄 + 总控台 status，决定放行还是拒绝。
 *   - 'ttl'    : 超过终极兜底时长，无条件放行；
 *   - 'orphan' : 总控台已空闲/等待输入/会话不在 且超过宽限期 = 答完没回传，放行；
 *   - 'reject' : 仍在生成中，拒绝并提示。
 */
export function classifyPendingGate(opts: {
  ageMs: number;
  hubStatus: string | undefined;
  ttlMs?: number;
  graceMs?: number;
}): "ttl" | "orphan" | "reject" {
  const ttl = opts.ttlMs ?? PENDING_TTL_MS;
  const grace = opts.graceMs ?? ORPHAN_IDLE_GRACE_MS;
  if (opts.ageMs > ttl) return "ttl";
  const idleish =
    opts.hubStatus === "idle" ||
    opts.hubStatus === "waiting_input" ||
    opts.hubStatus === undefined;
  if (opts.ageMs > grace && idleish) return "orphan";
  return "reject";
}

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
// hub 转 idle 后启动的「孤儿自动放行」定时器；working 来临或正常回传时清掉。
let orphanTimer: ReturnType<typeof setTimeout> | null = null;

function clearOrphanTimer(): void {
  if (orphanTimer) {
    clearTimeout(orphanTimer);
    orphanTimer = null;
  }
}

/** hub 当前 status；会话不存在返回 undefined。 */
function hubStatus(): string | undefined {
  const id = getHubSessionId();
  return id ? statusManager.get(id) : undefined;
}

/**
 * 总控台状态变化回调（registerWechatInbound 里挂到 statusManager）：
 *   - 转 working/starting：AI 又在干活，撤销待放行定时器，继续等它回传。
 *   - 转 idle/waiting_input 且仍有 pending：宽限后自动放行 + 通知 owner，
 *     这样即使 owner 不发任何消息，卡死的锁也会自己解开。
 */
function onHubStatusChange(sessionId: string, status: string): void {
  const hubId = getHubSessionId();
  if (!hubId || sessionId !== hubId) return;
  if (status === "working" || status === "starting" || status === "running") {
    clearOrphanTimer();
    return;
  }
  if ((status === "idle" || status === "waiting_input") && pending) {
    clearOrphanTimer();
    const target = pending;
    orphanTimer = setTimeout(() => {
      orphanTimer = null;
      if (!pending || pending.requestId !== target.requestId) return; // 已正常回传
      serverLog("warn", "wechat", "pending 因总控台空闲自动放行", {
        meta: { requestId: target.requestId, hubStatus: status },
      });
      pending = null;
      void wechatClient
        .sendReply(
          target.fromUserId,
          target.contextToken,
          "ℹ️ 上一条似乎已在总控台处理完，但没有回传到这里，已自动解锁，可以继续发问了。",
        )
        .catch(() => {
          /* 回传凭证可能已过期，解锁本身已生效 */
        });
    }, ORPHAN_IDLE_GRACE_MS);
  }
}

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
    clearOrphanTimer(); // 正常回传，撤销可能在排队的自动放行
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

  // 3.5) 逃生指令：owner 主动解锁，绕过 pending 闸口（否则卡死时连解锁都发不进去）。
  if (isCancelWord(text)) {
    const had = pending !== null;
    pending = null;
    clearOrphanTimer();
    serverLog("info", "wechat", "owner 逃生解锁", { meta: { hadPending: had } });
    await replyBestEffort(
      msg,
      had
        ? "✅ 已解锁，上一条不再等待，可以重新发问了。"
        : "ℹ️ 当前没有在等待的请求，可直接发问。",
    );
    return;
  }

  // 4) 串行单请求闸口。三道放行：超时兜底 / 总控台已空闲的孤儿请求 / 否则拒绝。
  if (pending) {
    const verdict = classifyPendingGate({
      ageMs: Date.now() - pending.createdAt,
      hubStatus: hubStatus(),
    });
    if (verdict === "reject") {
      await replyBestEffort(
        msg,
        "⏳ 总控台正在生成上一条的回答，等回复到了再发下一条。\n（如果卡住了，发「取消」即可解锁。）",
      );
      return;
    }
    serverLog("warn", "wechat", `pending ${verdict === "ttl" ? "超时" : "孤儿"}放行`, {
      meta: { requestId: pending.requestId, verdict },
    });
    pending = null;
    clearOrphanTimer();
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
    const ok = await writeHubInput(sessionId, `[微信 requestId=${requestId}] ${text}`);
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
  // 监听总控台状态：转 idle 后若 pending 仍卡着，宽限后自动放行（见 onHubStatusChange）。
  statusManager.on("change", onHubStatusChange);
}
