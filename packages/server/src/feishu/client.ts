import * as lark from "@larksuiteoapi/node-sdk";
import { serverLog } from "../log-bus.js";
import { getFeishuConfig, isFeishuConfigured, type FeishuConfig } from "./config.js";

/**
 * Raw inbound message payload shape we care about (subset of the SDK's
 * `im.message.receive_v1` event). inbound.ts registers a handler for these.
 */
export interface FeishuInboundMessage {
  eventId: string;
  chatId: string;
  chatType: string; // "p2p" | "group" | ...
  openId: string | undefined; // sender open_id
  messageType: string; // "text" | "post" | ...
  content: string; // raw JSON string from feishu
  mentions: Array<{ key: string; name: string }>;
}

type MessageHandler = (msg: FeishuInboundMessage) => void | Promise<void>;

export type FeishuConnState = "off" | "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export interface FeishuRuntimeStatus {
  running: boolean;
  state: FeishuConnState;
  configured: boolean;
  appId: string;
  lastError: string | null;
}

function domainOf(cfg: FeishuConfig): lark.Domain {
  return cfg.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

function tokenEndpoint(domain: "feishu" | "lark"): string {
  const base = domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  return `${base}/open-apis/auth/v3/tenant_access_token/internal`;
}

class FeishuClient {
  private ws: lark.WSClient | null = null;
  private api: lark.Client | null = null;
  private handler: MessageHandler | null = null;
  private state: FeishuConnState = "off";
  private lastError: string | null = null;
  private appId = "";

  /** inbound.ts wires its handler here before start(). */
  setMessageHandler(fn: MessageHandler): void {
    this.handler = fn;
  }

  isRunning(): boolean {
    return this.ws !== null;
  }

  getStatus(): FeishuRuntimeStatus {
    const cfg = getFeishuConfig();
    let state = this.state;
    if (this.ws) {
      try {
        const s = this.ws.getConnectionStatus();
        state = s.state as FeishuConnState;
      } catch {
        /* keep cached state */
      }
    }
    return {
      running: this.ws !== null,
      state,
      configured: isFeishuConfigured(cfg),
      appId: cfg.appId,
      lastError: this.lastError,
    };
  }

  /**
   * (Re)start the long-lived WebSocket connection from current config.
   * No-op-with-log when the bridge isn't configured. Safe to call repeatedly;
   * always tears down any existing connection first.
   */
  async start(): Promise<void> {
    const cfg = getFeishuConfig();
    await this.stop();
    if (!isFeishuConfigured(cfg)) {
      this.state = "off";
      serverLog("info", "feishu", "connect 跳过：未配置或未启用");
      return;
    }
    const t0 = Date.now();
    serverLog("info", "feishu", "connect 开始", { meta: { appId: cfg.appId, domain: cfg.domain } });
    this.appId = cfg.appId;
    this.lastError = null;
    this.state = "connecting";
    try {
      this.api = new lark.Client({ appId: cfg.appId, appSecret: cfg.appSecret, domain: domainOf(cfg) });
      this.ws = new lark.WSClient({
        appId: cfg.appId,
        appSecret: cfg.appSecret,
        domain: domainOf(cfg),
        loggerLevel: lark.LoggerLevel.warn,
        autoReconnect: true,
        onReady: () => {
          this.state = "connected";
          serverLog("info", "feishu", `connect 成功 (${Date.now() - t0}ms)`, { meta: { appId: cfg.appId } });
        },
        onError: (err: Error) => {
          this.state = "failed";
          this.lastError = err.message;
          serverLog("error", "feishu", `connect 失败: ${err.message}`, {
            meta: { error: { name: err.name, message: err.message, stack: err.stack } },
          });
        },
        onReconnecting: () => {
          this.state = "reconnecting";
          serverLog("warn", "feishu", "connect 重连中");
        },
        onReconnected: () => {
          this.state = "connected";
          serverLog("info", "feishu", "connect 重连成功");
        },
      });
      const dispatcher = new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          await this.onRawMessage(data);
        },
      });
      // start() resolves once the first handshake is initiated; onReady fires on success.
      await this.ws.start({ eventDispatcher: dispatcher });
    } catch (err) {
      const e = err as Error;
      this.state = "failed";
      this.lastError = e.message;
      this.ws = null;
      this.api = null;
      serverLog("error", "feishu", `connect 失败: ${e.message}`, {
        meta: { error: { name: e.name, message: e.message, stack: e.stack } },
      });
    }
  }

  async stop(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.api = null;
    this.state = "off";
  }

  private async onRawMessage(data: unknown): Promise<void> {
    if (!this.handler) return;
    const d = data as {
      event_id?: string;
      sender?: { sender_id?: { open_id?: string } };
      message?: {
        message_id: string;
        chat_id: string;
        chat_type: string;
        message_type: string;
        content: string;
        mentions?: Array<{ key: string; name: string }>;
      };
    };
    const m = d.message;
    if (!m) return;
    const msg: FeishuInboundMessage = {
      eventId: d.event_id || m.message_id,
      chatId: m.chat_id,
      chatType: m.chat_type,
      openId: d.sender?.sender_id?.open_id,
      messageType: m.message_type,
      content: m.content,
      mentions: (m.mentions || []).map((x) => ({ key: x.key, name: x.name })),
    };
    try {
      await this.handler(msg);
    } catch (err) {
      const e = err as Error;
      serverLog("error", "feishu", `inbound handler 异常: ${e.message}`, {
        meta: { error: { name: e.name, message: e.message } },
      });
    }
  }

  /**
   * Send a plain-text message. `receiveIdType` is "open_id" for private chat
   * (the owner) or "chat_id" for a group. Throws on failure so callers can
   * log an outbound ERROR.
   */
  async sendText(receiveId: string, receiveIdType: "open_id" | "chat_id", text: string): Promise<void> {
    if (!this.api) throw new Error("飞书客户端未连接");
    const res = await this.api.im.v1.message.create({
      data: { receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text }) },
      params: { receive_id_type: receiveIdType },
    });
    if (res.code && res.code !== 0) {
      throw new Error(`飞书发送失败 code=${res.code} msg=${res.msg ?? ""}`);
    }
  }
}

export const feishuClient = new FeishuClient();

/**
 * Stateless credential check for the「测试连接」button. Hits the tenant access
 * token endpoint directly (only needs valid app_id/app_secret, no scopes), so
 * it's a crisp yes/no without touching the live WS connection.
 */
export async function testFeishuConnection(
  appId: string,
  appSecret: string,
  domain: "feishu" | "lark",
): Promise<{ ok: boolean; message: string }> {
  if (!appId || !appSecret) return { ok: false, message: "App ID / App Secret 不能为空" };
  try {
    const res = await fetch(tokenEndpoint(domain), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const body = (await res.json()) as { code?: number; msg?: string };
    if (body.code === 0) return { ok: true, message: "连接成功" };
    return { ok: false, message: `凭证无效：${body.msg ?? "未知错误"} (code=${body.code})` };
  } catch (err) {
    const e = err as Error;
    return { ok: false, message: `网络错误：${e.message}` };
  }
}
