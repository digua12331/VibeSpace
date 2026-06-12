import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";
import { ptyManager } from "../pty-manager.js";
import { statusManager } from "../status.js";
import { serverLog } from "../log-bus.js";
import { ensureHubSession, getHubSessionId, writeHubInput, writeHubAnswer } from "../hub-session.js";
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

// ---- 弹框检测（纯函数，扫总控台 PTY buffer 尾部判断 claude 是否在等你选）----

// 去掉终端转义序列（CSI 颜色/光标、OSC 标题）+ 裸控制字符后才好按行扫文本。
// 用 charCode 扫描而非正则，避免源码里出现裸 ESC 字节。保留 制表/换行/回车。
export function stripAnsi(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x1b) {
      const next = s[i + 1];
      if (next === "[") {
        // CSI：吃到第一个 ASCII 字母（终止符）为止。
        i += 2;
        while (i < s.length && !/[A-Za-z]/.test(s[i])) i += 1;
        continue;
      }
      if (next === "]") {
        // OSC：吃到 BEL(0x07) 或下一个 ESC 为止。
        i += 2;
        while (i < s.length && s.charCodeAt(i) !== 0x07 && s.charCodeAt(i) !== 0x1b) i += 1;
        continue;
      }
      i += 1; // 其它 ESC x：跳过 ESC + 一个字节。
      continue;
    }
    if (c === 0x09 || c === 0x0a || c === 0x0d) {
      out += s[i];
      continue;
    }
    if (c < 0x20 || c === 0x7f) continue; // 丢弃其余控制字符
    out += s[i];
  }
  return out;
}

export interface HubPromptDetection {
  isPrompt: boolean;
  /** 推给 owner 的可读文本（已去 ANSI、取尾部若干行、限长）。 */
  text: string;
  /** 同一弹框去重指纹（归一化的选项行）。 */
  fingerprint: string;
}

/**
 * 从 PTY 原始缓冲判断 claude 是否停在一个「需要你选/确认」的弹框上，并提取
 * 可读文本 + 去重指纹。启发式：扫尾部约 20 行，命中选择光标 `❯`、编号选项
 * `1. 2.`、`(y/n)`、`Do you want|trust`、`是否` 等特征即判为弹框。
 * 刻意不穷举所有 TUI 样式——先覆盖 claude 最常见的几种确认框。
 */
export function detectHubPrompt(buffer: string): HubPromptDetection {
  const clean = stripAnsi(buffer);
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0);
  const tail = lines.slice(-20);
  const tailText = tail.join("\n");
  const isPrompt =
    /❯/.test(tailText) ||
    /\(\s*y\s*\/\s*n\s*\)/i.test(tailText) ||
    /\[\s*y\s*\/\s*n\s*\]/i.test(tailText) ||
    /do you (want|trust|wish)/i.test(tailText) ||
    /是否|继续吗|确认吗|请选择/.test(tailText) ||
    (/(^|\s)1\.\s/.test(tailText) && /(^|\s)2\.\s/.test(tailText));
  const optionLines = tail.filter((l) =>
    /❯|^\s*\d+\.\s|\(\s*y\s*\/\s*n\s*\)|是否|do you/i.test(l),
  );
  const fingerprint = (optionLines.join("|") || tailText.slice(-200)).slice(0, 200);
  let text = tailText;
  if (text.length > 1200) text = "…\n" + text.slice(-1200);
  return { isPrompt, text, fingerprint };
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
  /** 总控台弹出选择框、已推给 owner、正等他回数字时为 true。 */
  awaitingChoice: boolean;
  /** 已推送弹框的去重指纹，防同一框的 Notification 连发重复刷屏。 */
  promptFingerprint: string | null;
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
 * 把总控台的弹框推给 owner 微信。best-effort，失败只记日志不抛
 * （contextToken 可能已过期；解锁/重发由 owner 决定）。
 */
function forwardPromptToOwner(target: PendingRequest, promptText: string): void {
  const t0 = Date.now();
  serverLog("info", "wechat", "prompt-forward 开始", {
    meta: { requestId: target.requestId },
  });
  void wechatClient
    .sendReply(
      target.fromUserId,
      target.contextToken,
      `⚠️ 总控台在等你选择，回复对应数字或一句话即可：\n\n${promptText}\n\n（卡住就发「取消」解锁）`,
    )
    .then(() => {
      serverLog("info", "wechat", `prompt-forward 成功 (${Date.now() - t0}ms)`, {
        meta: { requestId: target.requestId },
      });
    })
    .catch((err: unknown) => {
      const e = err as Error;
      serverLog("error", "wechat", `prompt-forward 失败: ${e.message}`, {
        meta: { requestId: target.requestId, error: { name: e.name, message: e.message } },
      });
    });
}

/**
 * 总控台状态变化回调（registerWechatInbound 里挂到 statusManager）：
 *   - 转 working/starting：AI 又在干活，撤销待放行定时器；若刚才在等回答说明
 *     选择已被消费，清掉 awaitingChoice/指纹，让下一个弹框能重新被识别。
 *   - 转 waiting_input 且有 pending：先判这是不是真弹框（扫 PTY 选项特征）。
 *       · 是真弹框 → 把问题+选项推给 owner，置 awaitingChoice，等他回数字；
 *         **不**走孤儿解锁（否则会误报「已处理完」）。
 *       · 不是弹框（claude 答完停在主输入框）→ 维持原孤儿宽限自动解锁。
 *   - 转 idle 且有 pending → 同样走孤儿宽限自动解锁。
 */
function onHubStatusChange(sessionId: string, status: string): void {
  const hubId = getHubSessionId();
  if (!hubId || sessionId !== hubId) return;
  if (status === "working" || status === "starting" || status === "running") {
    clearOrphanTimer();
    if (pending) {
      pending.awaitingChoice = false;
      pending.promptFingerprint = null;
    }
    return;
  }
  if (status === "waiting_input" && pending) {
    const detected = detectHubPrompt(ptyManager.getBuffer(hubId));
    if (detected.isPrompt) {
      if (pending.promptFingerprint === detected.fingerprint) return; // 同一框已推过
      clearOrphanTimer();
      pending.awaitingChoice = true;
      pending.promptFingerprint = detected.fingerprint;
      forwardPromptToOwner(pending, detected.text);
      return;
    }
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

  // 3.6) 总控台正等你回答弹框：本条消息当「选择」敲回终端，不当新指令。
  if (pending && pending.awaitingChoice) {
    pending.awaitingChoice = false;
    const hubId = getHubSessionId();
    if (!hubId) {
      pending = null;
      await replyBestEffort(msg, "⚠️ 总控台会话已不在，发「取消」后重新发问即可。");
      return;
    }
    const t0 = Date.now();
    serverLog("info", "wechat", "prompt-answer 开始", {
      sessionId: hubId,
      meta: { requestId: pending.requestId, len: text.length },
    });
    try {
      const ok = await writeHubAnswer(hubId, text);
      if (!ok) throw new Error("总控台 PTY 写入失败（会话可能已退出）");
      serverLog("info", "wechat", `prompt-answer 成功 (${Date.now() - t0}ms)`, {
        sessionId: hubId,
        meta: { requestId: pending.requestId },
      });
      await replyBestEffort(msg, "✅ 已把你的选择回给总控台。");
    } catch (err) {
      const e = err as Error;
      serverLog("error", "wechat", `prompt-answer 失败: ${e.message}`, {
        meta: { requestId: pending?.requestId, error: { name: e.name, message: e.message } },
      });
      await replyBestEffort(msg, `⚠️ 回传选择失败：${e.message}（发「取消」可解锁）`);
    }
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
  pending = {
    requestId,
    fromUserId: msg.fromUserId,
    contextToken: msg.contextToken,
    createdAt: Date.now(),
    awaitingChoice: false,
    promptFingerprint: null,
  };
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
