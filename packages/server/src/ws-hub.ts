import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ptyManager, lastInputAt } from "./pty-manager.js";
import { statusManager } from "./status.js";
import type { SessionStatus } from "./db.js";
import { persistClientLog, handleClientLogRoundtrip, serverLog } from "./log-bus.js";
import type { ClientLogPayload, LogLevel } from "./types/log.js";

export const SERVER_VERSION = "0.1.0";

interface ClientCtx {
  socket: WebSocket;
  subs: Set<string>;
  // 背压:bufferedAmount 超 CLIENT_BUFFER_HARD_CAP_BYTES 时该 client 被主动断开。
  // 置位后所有 fan-out 路径跳过它,直到 'close' 事件把它从 clients 移除——防止
  // close() 与 close 事件之间继续堆数据,也防同一慢 client 记多条 warn。
  closing?: boolean;
}

// Module-level client set so non-WS modules (e.g. log-bus) can broadcast.
// registerWsHub() owns its lifecycle; if not yet registered, broadcast is a no-op.
const clients = new Set<ClientCtx>();

export function broadcast(msg: Record<string, unknown>): void {
  const data = JSON.stringify(msg);
  for (const c of clients) sendFanout(c, data);
}

// ---- Per-session output coalescing ----
// node-pty 在 AI 全速输出时每秒可以发几十次 chunk（每次几百字节~几 KB），
// 之前是每个 chunk 立刻 JSON.stringify + 给所有订阅 client 调 send。同开
// 多个 AI 终端时浏览器事件循环被这些小消息切碎，前端 CPU 长时间高位。
// 改成 per-session 16ms（一帧）窗口合并：同一 session 在一帧内攒下的所有
// chunk 按到达顺序拼接成一条 output 消息再发。
// 安全性：
//   - 只合并同一 sessionId 的 output，不跨 session、不重排、不截断；
//   - exit/status/error 这类边界消息送达前会 flushSessionOutput(sid)，
//     保证"进程结束/状态切换"前那一屏内容先到；
//   - 前端 xterm 的 ANSI 状态机本身能跨多次 write 处理转义序列，
//     按帧拼接的 chunk 等价于"一次大 write"，不破坏颜色/光标控制。
const OUTPUT_FLUSH_MS = 16;

// 背压两道上限:
//  - CLIENT_BUFFER_HARD_CAP_BYTES:单个 WS 连接的 socket.bufferedAmount(已塞进
//    发送缓冲但还没真正发出去的字节)超过这个值,说明该 client 慢到追不上输出,
//    主动断开它(前端会自动重连 + replay 重画,见 ws.ts / SessionView.tsx)。偏
//    保守,避开普通网络抖动误杀,主要挡后台标签页 throttle / 远程弱网持续堆积。
//  - SESSION_QUEUE_FLUSH_BYTES:单 session 的 16ms 合并队列攒到这么多字节就立即
//    flush(而非等满 16ms),bound 住 server 端队列内存。略高于 pty-manager 的
//    200KB ring buffer——队列堆到这量级还等 16ms 已无收益。
const CLIENT_BUFFER_HARD_CAP_BYTES = 8 * 1024 * 1024;
const SESSION_QUEUE_FLUSH_BYTES = 256 * 1024;

interface OutputQueue {
  chunks: string[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const outputQueues = new Map<string, OutputQueue>();

function flushSessionOutput(sessionId: string): void {
  const q = outputQueues.get(sessionId);
  if (!q) return;
  if (q.timer) {
    clearTimeout(q.timer);
    q.timer = null;
  }
  if (q.chunks.length === 0) return;
  const data = q.chunks.length === 1 ? q.chunks[0] : q.chunks.join("");
  q.chunks.length = 0;
  q.bytes = 0;
  const msg = JSON.stringify({ type: "output", sessionId, data });
  for (const c of clients) {
    if (c.subs.has(sessionId)) sendFanout(c, msg);
  }
}

function enqueueOutput(sessionId: string, data: string): void {
  let q = outputQueues.get(sessionId);
  if (!q) {
    q = { chunks: [], bytes: 0, timer: null };
    outputQueues.set(sessionId, q);
  }
  q.chunks.push(data);
  q.bytes += Buffer.byteLength(data, "utf8");
  // 队列攒到上限就立即吐出,不等满 16ms,bound 住 server 端合并队列内存。
  // flushSessionOutput 会清 chunks/bytes 并清 timer,所以这里 flush 后下面
  // 那个"没 timer 才建 timer"的分支会重新按需建,不会二次 flush 空队列。
  if (q.bytes >= SESSION_QUEUE_FLUSH_BYTES) {
    flushSessionOutput(sessionId);
    return;
  }
  if (q.timer == null) {
    q.timer = setTimeout(() => {
      if (q) q.timer = null;
      flushSessionOutput(sessionId);
    }, OUTPUT_FLUSH_MS);
  }
}

function disposeSessionQueue(sessionId: string): void {
  const q = outputQueues.get(sessionId);
  if (!q) return;
  if (q.timer) {
    clearTimeout(q.timer);
    q.timer = null;
  }
  outputQueues.delete(sessionId);
}

/**
 * WS protocol (JSON line framed by ws message boundaries):
 *
 *   Client → Server:
 *     { type: 'subscribe',   sessionIds: string[] }
 *     { type: 'unsubscribe', sessionIds: string[] }
 *     { type: 'input',       sessionId, data }
 *     { type: 'resize',      sessionId, cols, rows }
 *     { type: 'replay',      sessionId }
 *     { type: 'log-from-client', level, scope, msg, projectId?, sessionId?, meta? }
 *
 *   Server → Client:
 *     { type: 'hello', serverVersion }
 *     { type: 'output', sessionId, data }
 *     { type: 'status', sessionId, status, detail? }
 *     { type: 'exit',   sessionId, code, signal }
 *     { type: 'replay', sessionId, data }
 *     { type: 'error',  message }
 *     { type: 'log',    level, scope, msg, projectId?, sessionId?, meta? }
 *     { type: 'error-pattern-alert', alert: ErrorPatternAlert }
 */
export function registerWsHub(app: FastifyInstance): void {
  // ---- PTY → broadcast (output 走 per-session 16ms 合并队列) ----
  ptyManager.on("output", (sessionId: string, data: string) => {
    enqueueOutput(sessionId, data);
  });
  ptyManager.on(
    "exit",
    (sessionId: string, code: number | null, signal: number | null) => {
      // 边界消息强制 flush：进程结束前最后一屏 output 必须先到，否则用户
      // 会看到"进程结束了但最后几行输出丢了"。
      flushSessionOutput(sessionId);
      const msg = JSON.stringify({ type: "exit", sessionId, code, signal });
      for (const c of clients) {
        if (c.subs.has(sessionId)) sendFanout(c, msg);
      }
      // session 已退出，清理合并队列，防止 sessionId 复用时残留。
      disposeSessionQueue(sessionId);
    },
  );

  // ---- Status → broadcast (边界 flush) ----
  statusManager.on(
    "change",
    (sessionId: string, status: SessionStatus, detail?: string) => {
      // 状态切换（idle→busy 等）前先把已攒 output 吐出去，保证状态变更与
      // 屏幕内容时序一致，不让前端看到"状态变了但终端还停在上一帧"。
      flushSessionOutput(sessionId);
      const msg = JSON.stringify({ type: "status", sessionId, status, detail });
      for (const c of clients) {
        if (c.subs.has(sessionId)) sendFanout(c, msg);
      }
    },
  );

  app.get("/ws", { websocket: true }, (socket /* WebSocket */, _req) => {
    const ctx: ClientCtx = { socket, subs: new Set() };
    clients.add(ctx);

    safeSend(
      socket,
      JSON.stringify({ type: "hello", serverVersion: SERVER_VERSION }),
    );

    socket.on("message", (raw: Buffer) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        safeSend(socket, JSON.stringify({ type: "error", message: "invalid JSON" }));
        return;
      }
      handleClientMsg(ctx, msg);
    });

    socket.on("close", () => {
      clients.delete(ctx);
    });
    socket.on("error", () => {
      clients.delete(ctx);
    });
  });

  app.addHook("onClose", async () => {
    for (const c of clients) {
      try { c.socket.close(); } catch { /* noop */ }
    }
    clients.clear();
  });
}

function handleClientMsg(ctx: ClientCtx, msg: unknown): void {
  if (!isObj(msg) || typeof msg.type !== "string") {
    safeSend(ctx.socket, JSON.stringify({ type: "error", message: "missing type" }));
    return;
  }
  switch (msg.type) {
    case "subscribe": {
      const ids = Array.isArray(msg.sessionIds) ? (msg.sessionIds as unknown[]) : [];
      for (const id of ids) {
        if (typeof id !== "string") continue;
        ctx.subs.add(id);
        // push current status if known
        const st = statusManager.get(id);
        if (st) {
          safeSend(
            ctx.socket,
            JSON.stringify({ type: "status", sessionId: id, status: st }),
          );
        }
      }
      return;
    }
    case "unsubscribe": {
      const ids = Array.isArray(msg.sessionIds) ? (msg.sessionIds as unknown[]) : [];
      for (const id of ids) {
        if (typeof id === "string") ctx.subs.delete(id);
      }
      return;
    }
    case "input": {
      const sid = msg.sessionId;
      const data = msg.data;
      if (typeof sid !== "string" || typeof data !== "string") {
        safeSend(
          ctx.socket,
          JSON.stringify({ type: "error", message: "input requires sessionId+data" }),
        );
        return;
      }
      lastInputAt.set(sid, Date.now());
      const ok = ptyManager.write(sid, data);
      if (!ok) {
        safeSend(
          ctx.socket,
          JSON.stringify({ type: "error", message: `no live session ${sid}` }),
        );
      }
      return;
    }
    case "resize": {
      const sid = msg.sessionId;
      const cols = msg.cols;
      const rows = msg.rows;
      if (
        typeof sid !== "string" ||
        typeof cols !== "number" ||
        typeof rows !== "number"
      ) {
        safeSend(
          ctx.socket,
          JSON.stringify({
            type: "error",
            message: "resize requires sessionId+cols+rows",
          }),
        );
        return;
      }
      ptyManager.resize(sid, cols, rows);
      return;
    }
    case "replay": {
      const sid = msg.sessionId;
      if (typeof sid !== "string") {
        safeSend(
          ctx.socket,
          JSON.stringify({ type: "error", message: "replay requires sessionId" }),
        );
        return;
      }
      // 先 flush 合并队列，保证 snapshot 之前所有已知 chunk 已广播到所有
      // 订阅者，避免"客户端收到 replay 后又收到一条 output，但这段内容
      // snapshot 里已经含"的语义不一致。flush 会同步把队列清掉。
      flushSessionOutput(sid);
      const buf = ptyManager.getBuffer(sid);
      safeSend(
        ctx.socket,
        JSON.stringify({ type: "replay", sessionId: sid, data: buf }),
      );
      return;
    }
    case "log-from-client": {
      const payload = parseClientLogPayload(msg);
      if (!payload) {
        safeSend(
          ctx.socket,
          JSON.stringify({
            type: "error",
            message: "log-from-client requires {level,scope,msg}",
          }),
        );
        return;
      }
      persistClientLog(payload);
      handleClientLogRoundtrip(payload);
      return;
    }
    default:
      safeSend(
        ctx.socket,
        JSON.stringify({ type: "error", message: `unknown type: ${msg.type}` }),
      );
  }
}

function safeSend(sock: WebSocket, data: string): void {
  try {
    if (sock.readyState === sock.OPEN) sock.send(data);
  } catch {
    /* ignore */
  }
}

/**
 * 一对多广播(output/exit/status/log broadcast)专用的发送:发送前做背压检查。
 * 若该 client 的 socket.bufferedAmount 已超 CLIENT_BUFFER_HARD_CAP_BYTES,说明它
 * 慢到追不上输出,主动断开它(前端自动重连 + replay 重画恢复),而不是无上限往它
 * 的发送缓冲里继续堆——后者会拖垮 server 内存、且一个慢 client 不该影响其它人。
 *
 * 顺序固定:先置 closing(让后续所有 fan-out 跳过它)→ 记一条 warn → close()。
 * closing 已置位的直接跳过:防重复 close、防同一慢 client 刷 warn(日志风暴)。
 *
 * 注意:只给 fan-out 用。给单个请求方的一次性回复(error/hello/replay 响应)仍走
 * safeSend——它们不是洪峰源,且 replay 一次约 200KB 远低于 8MB 上限。
 * 关服(onClose)主动 close 也不走这里,正常 shutdown 不该打 warn。
 */
function sendFanout(ctx: ClientCtx, data: string): void {
  if (ctx.closing) return;
  // ws@8 的运行时 WebSocket 有 bufferedAmount getter,但本仓库解析到的 ws 类型
  // 未声明它,故用一个收窄的访问器读,避免 any。读不到当 0 处理(不误杀)。
  const buffered =
    (ctx.socket as unknown as { bufferedAmount?: number }).bufferedAmount ?? 0;
  if (buffered > CLIENT_BUFFER_HARD_CAP_BYTES) {
    ctx.closing = true;
    serverLog("warn", "ws", "slow client disconnected: send buffer over cap", {
      meta: {
        bufferedAmount: buffered,
        cap: CLIENT_BUFFER_HARD_CAP_BYTES,
      },
    });
    try {
      ctx.socket.close();
    } catch {
      /* ignore */
    }
    return;
  }
  safeSend(ctx.socket, data);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function parseClientLogPayload(
  msg: Record<string, unknown>,
): ClientLogPayload | null {
  const level = msg.level;
  const scope = msg.scope;
  const text = msg.msg;
  if (
    (level !== "info" && level !== "warn" && level !== "error") ||
    typeof scope !== "string" ||
    typeof text !== "string"
  ) {
    return null;
  }
  return {
    level: level as LogLevel,
    scope,
    msg: text,
    projectId: typeof msg.projectId === "string" ? msg.projectId : undefined,
    sessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined,
    meta: msg.meta,
  };
}
