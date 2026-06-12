import { serverLog } from "../log-bus.js";
import { wechatClient } from "./client.js";
import { registerWechatInbound } from "./inbound.js";

/**
 * Single bootstrap entry for the WeChat (ilink) bridge, called fire-and-forget
 * after the HTTP server is listening. A failure here must never take down the
 * rest of the server — the bridge is opt-in（未登录/未启用时 start 是 no-op）.
 */
export function startWechatBridge(): void {
  try {
    registerWechatInbound();
    wechatClient.start();
  } catch (err) {
    const e = err as Error;
    serverLog("error", "wechat", `bridge 启动失败: ${e.message}`, {
      meta: { error: { name: e.name, message: e.message } },
    });
  }
}

/** Server shutdown: stop loops and abort in-flight long-poll requests. */
export function stopWechatBridge(): void {
  wechatClient.stop();
}
