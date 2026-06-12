import { randomUUID } from "node:crypto";
import { serverLog } from "../log-bus.js";
import {
  getWechatConfig,
  setWechatConfig,
  isWechatConfigured,
  isAllowedIlinkBaseUrl,
  ILINK_LOGIN_BASE,
} from "./config.js";

/**
 * 微信 ilink 连接管理器（单实例）。取码、扫码轮询、getupdates 长轮询、发送、
 * 停止全在这一个类里，单一状态机。协议细节来自「微信ilink可行性试点」实测：
 *  - 请求头三件套（AuthorizationType / X-WECHAT-UIN 每次随机 / Bearer token）
 *  - qrcode_img_content 是登录链接（不是图片），前端负责渲染成二维码
 *  - getupdates 服务端最多 hold 35 秒；游标必须持久化
 *  - sendmessage 必须带唯一 client_id，否则出站通道 10-15 分钟内无声死亡
 *  - errcode/ret = -14 → 登录会话过期，唯一恢复手段是重新扫码
 *  - 发送成功只代表"请求被受理"（HTTP 200 空对象），协议没有送达回执
 */

export type WechatConnState = "idle" | "scanning" | "logged_in" | "error";

export interface WechatInboundMessage {
  /** 协议无显式 msg_id，用每条消息唯一的 context_token 充当去重键。 */
  dedupKey: string;
  fromUserId: string;
  contextToken: string;
  messageType: number;
  /** 纯文本内容；非文本消息为 null。 */
  text: string | null;
}

type MessageHandler = (msg: WechatInboundMessage) => void | Promise<void>;

export interface WechatRuntimeStatus {
  state: WechatConnState;
  configured: boolean;
  ownerBound: boolean;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

const QR_POLL_MS = 1500;
const QR_DEADLINE_MS = 3 * 60 * 1000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
const DEDUP_CAP = 500;

interface IlinkResponse {
  httpStatus: number;
  json: Record<string, unknown> | null;
}

class WechatClient {
  private state: WechatConnState = "idle";
  private lastError: string | null = null;
  private lastInboundAt: number | null = null;
  private lastOutboundAt: number | null = null;
  private handler: MessageHandler | null = null;
  /** 代次编号：login / startPolling / stop 都会 +1，旧循环发现代次变了就自行退出。 */
  private generation = 0;
  /** 在途请求的中止器（长轮询 / 扫码轮询共用，stop 时主动掐断）。 */
  private aborter: AbortController | null = null;
  /** 已处理消息的去重键（内存环形，崩溃重启靠游标语义兜底）。 */
  private seen = new Set<string>();

  setMessageHandler(fn: MessageHandler): void {
    this.handler = fn;
  }

  getStatus(): WechatRuntimeStatus {
    const cfg = getWechatConfig();
    return {
      state: this.state,
      configured: isWechatConfigured(cfg),
      ownerBound: cfg.ownerUserId.length > 0,
      lastError: this.lastError,
      lastInboundAt: this.lastInboundAt,
      lastOutboundAt: this.lastOutboundAt,
    };
  }

  // ---- HTTP 基础 ----------------------------------------------------------

  private headers(token?: string): Record<string, string> {
    const uin = Buffer.from(String((Math.random() * 0xffffffff) >>> 0)).toString("base64");
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": uin,
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private async call(
    base: string,
    path: string,
    opts: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {},
  ): Promise<IlinkResponse> {
    const res = await fetch(`${base}${path}`, {
      method: opts.method ?? "POST",
      headers: this.headers(opts.token),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* 非 JSON 响应按 null 处理 */
    }
    return { httpStatus: res.status, json };
  }

  /** -14 = 登录会话过期（getupdates 与 sendmessage 共用判定）。 */
  private isSessionExpired(json: Record<string, unknown> | null): boolean {
    if (!json) return false;
    return json.errcode === -14 || json.ret === -14;
  }

  private dieSession(reason: string): void {
    this.generation++;
    this.aborter?.abort();
    this.aborter = null;
    this.state = "error";
    this.lastError = reason;
    serverLog("error", "wechat", `session 失效: ${reason}`);
  }

  // ---- 登录（取码 + 扫码轮询） --------------------------------------------

  /**
   * 取一张新二维码。代次 +1 使旧的登录/轮询循环全部失效（重复点取码只保留
   * 最新一个活跃任务）。返回登录链接，由前端渲染成二维码。
   */
  async beginLogin(): Promise<{ loginUrl: string }> {
    const gen = ++this.generation;
    this.aborter?.abort();
    this.aborter = new AbortController();
    this.state = "scanning";
    this.lastError = null;
    const r = await this.call(ILINK_LOGIN_BASE, "/ilink/bot/get_bot_qrcode?bot_type=3", {
      method: "GET",
      signal: this.aborter.signal,
    });
    const qrcode = r.json?.qrcode;
    const loginUrl = r.json?.qrcode_img_content;
    if (typeof qrcode !== "string" || typeof loginUrl !== "string" || !loginUrl.startsWith("http")) {
      this.state = "error";
      this.lastError = `取码失败（HTTP ${r.httpStatus}）`;
      throw new Error(this.lastError);
    }
    void this.pollQrStatus(gen, qrcode);
    return { loginUrl };
  }

  private async pollQrStatus(gen: number, qrcode: string): Promise<void> {
    const deadline = Date.now() + QR_DEADLINE_MS;
    while (this.generation === gen && Date.now() < deadline) {
      let r: IlinkResponse;
      try {
        r = await this.call(
          ILINK_LOGIN_BASE,
          `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
          { method: "GET", signal: this.aborter?.signal },
        );
      } catch {
        if (this.generation !== gen) return;
        await sleep(QR_POLL_MS);
        continue;
      }
      if (this.generation !== gen) return; // 取码被更新的操作取代，丢弃结果
      const status = r.json?.status;
      if (status === "confirmed") {
        const botToken = r.json?.bot_token;
        const rawBase = r.json?.baseurl;
        if (typeof botToken !== "string" || botToken.length === 0) {
          this.state = "error";
          this.lastError = "扫码确认了但响应里没有 bot_token";
          serverLog("error", "wechat", `login 失败: ${this.lastError}`);
          return;
        }
        const baseUrl =
          typeof rawBase === "string" && isAllowedIlinkBaseUrl(rawBase) ? rawBase : ILINK_LOGIN_BASE;
        setWechatConfig({ enabled: true, botToken, baseUrl, getUpdatesBuf: "" });
        serverLog("info", "wechat", "login 成功（扫码确认，token 已存）");
        this.startPolling();
        return;
      }
      if (status === "expired") {
        this.state = "error";
        this.lastError = "二维码已过期，请重新取码";
        serverLog("warn", "wechat", "login 二维码过期");
        return;
      }
      await sleep(QR_POLL_MS);
    }
    if (this.generation === gen && this.state === "scanning") {
      this.state = "error";
      this.lastError = "二维码已过期，请重新取码";
      serverLog("warn", "wechat", "login 等待扫码超时");
    }
  }

  // ---- 长轮询收消息 --------------------------------------------------------

  /** 服务启动恢复入口：开关开启且有凭证才恢复，从持久化游标继续。 */
  start(): void {
    const cfg = getWechatConfig();
    if (!isWechatConfigured(cfg)) {
      this.state = "idle";
      serverLog("info", "wechat", "connect 跳过：未配置或未启用");
      return;
    }
    this.startPolling();
  }

  private startPolling(): void {
    const gen = ++this.generation; // 单飞：任何旧循环看到代次变化即退出
    this.aborter?.abort();
    this.aborter = new AbortController();
    this.state = "logged_in";
    this.lastError = null;
    serverLog("info", "wechat", "poll 开始");
    void this.pollLoop(gen);
  }

  private async pollLoop(gen: number): Promise<void> {
    let failures = 0;
    while (this.generation === gen) {
      const cfg = getWechatConfig();
      let r: IlinkResponse;
      try {
        r = await this.call(cfg.baseUrl, "/ilink/bot/getupdates", {
          token: cfg.botToken,
          signal: this.aborter?.signal,
          body: { get_updates_buf: cfg.getUpdatesBuf, base_info: { channel_version: "1.0.2" } },
        });
      } catch (err) {
        if (this.generation !== gen) return; // stop()/新代次主动中止
        failures++;
        await sleep(backoff(failures));
        continue;
      }
      if (this.generation !== gen) return; // 旧代次结果一律丢弃，不写游标
      if (this.isSessionExpired(r.json)) {
        this.dieSession("登录已过期（-14），请重新取码");
        return;
      }
      if (!r.json || (r.json.ret !== undefined && r.json.ret !== 0)) {
        failures++;
        serverLog("warn", "wechat", `poll 异常响应 (HTTP ${r.httpStatus}, ret=${String(r.json?.ret)})，退避重试`);
        await sleep(backoff(failures));
        continue;
      }
      failures = 0;
      const msgs = Array.isArray(r.json.msgs) ? (r.json.msgs as Array<Record<string, unknown>>) : [];
      for (const raw of msgs) {
        const msg = this.parseMsg(raw);
        if (!msg) continue;
        if (this.seen.has(msg.dedupKey)) continue; // 崩溃重启后的重复投递
        this.remember(msg.dedupKey);
        this.lastInboundAt = Date.now();
        if (this.handler) {
          try {
            await this.handler(msg); // 先处理完，再提交游标（不丢消息）
          } catch (err) {
            const e = err as Error;
            serverLog("error", "wechat", `inbound handler 异常: ${e.message}`, {
              meta: { error: { name: e.name, message: e.message } },
            });
          }
        }
      }
      if (typeof r.json.get_updates_buf === "string" && r.json.get_updates_buf.length > 0) {
        setWechatConfig({ getUpdatesBuf: r.json.get_updates_buf });
      }
    }
  }

  private parseMsg(raw: Record<string, unknown>): WechatInboundMessage | null {
    const fromUserId = typeof raw.from_user_id === "string" ? raw.from_user_id : "";
    const contextToken = typeof raw.context_token === "string" ? raw.context_token : "";
    const messageType = typeof raw.message_type === "number" ? raw.message_type : -1;
    if (!fromUserId || messageType !== 1) return null; // 只关心用户发来的消息
    const items = Array.isArray(raw.item_list) ? (raw.item_list as Array<Record<string, unknown>>) : [];
    let text: string | null = null;
    for (const it of items) {
      if (it.type === 1 && it.text_item && typeof (it.text_item as Record<string, unknown>).text === "string") {
        text = (it.text_item as { text: string }).text;
        break;
      }
    }
    return {
      dedupKey: contextToken || `${fromUserId}:${JSON.stringify(items).slice(0, 64)}`,
      fromUserId,
      contextToken,
      messageType,
      text,
    };
  }

  private remember(key: string): void {
    this.seen.add(key);
    if (this.seen.size > DEDUP_CAP) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
  }

  // ---- 发送 ----------------------------------------------------------------

  /**
   * 给某条入站消息回话。client_id 必须每条唯一（试点第四轮结论：缺它出站
   * 通道会无声死亡）。注意协议无送达回执——成功仅代表"请求被受理"。
   */
  async sendReply(toUserId: string, contextToken: string, text: string): Promise<void> {
    const cfg = getWechatConfig();
    if (!cfg.botToken) throw new Error("微信未登录");
    const r = await this.call(cfg.baseUrl, "/ilink/bot/sendmessage", {
      token: cfg.botToken,
      body: {
        msg: {
          client_id: `vibe-${randomUUID()}`,
          to_user_id: toUserId,
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [{ type: 1, text_item: { text } }],
        },
      },
    });
    if (this.isSessionExpired(r.json)) {
      this.dieSession("登录已过期（-14），请重新取码");
      throw new Error("微信登录已过期，请在设置里重新取码");
    }
    if (r.httpStatus !== 200 || (r.json && r.json.ret !== undefined && r.json.ret !== 0)) {
      throw new Error(`发送被拒（HTTP ${r.httpStatus}, ret=${String(r.json?.ret)}, errmsg=${String(r.json?.errmsg ?? "")}）`);
    }
    this.lastOutboundAt = Date.now();
  }

  // ---- 停止 / 登出 ----------------------------------------------------------

  /** 停止一切循环并中止在途请求。状态回 idle。 */
  stop(): void {
    this.generation++;
    this.aborter?.abort();
    this.aborter = null;
    this.state = "idle";
  }

  /** 普通退出：清凭证与游标，保留 owner 绑定。 */
  logout(): void {
    this.stop();
    setWechatConfig({ enabled: false, botToken: "", baseUrl: ILINK_LOGIN_BASE, getUpdatesBuf: "" });
    serverLog("info", "wechat", "logout 完成（保留 owner 绑定）");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 有上限带抖动的退避。 */
function backoff(failures: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 5), BACKOFF_MAX_MS);
  return base + Math.floor(Math.random() * 500);
}

export const wechatClient = new WechatClient();
