import { serverLog } from "../log-bus.js";
import { feishuClient } from "./client.js";
import { registerInbound } from "./inbound.js";
import { registerOutbound } from "./outbound.js";

/**
 * Single bootstrap entry for the Feishu bridge, called fire-and-forget after
 * the HTTP server is listening. Wires inbound / outbound / worker-notify (added
 * in later phases) then opens the long-lived WebSocket. A failure here must
 * never take down the rest of the server — the bridge is opt-in.
 */
export async function startFeishuBridge(): Promise<void> {
  try {
    registerInbound();
    registerOutbound();
    await feishuClient.start();
  } catch (err) {
    const e = err as Error;
    serverLog("error", "feishu", `bridge 启动失败: ${e.message}`, {
      meta: { error: { name: e.name, message: e.message } },
    });
  }
}
