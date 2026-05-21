import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ptyManager, lastInputAt } from "./pty-manager.js";
import { statusManager } from "./status.js";
import type { SessionStatus } from "./db.js";
import { persistClientLog, handleClientLogRoundtrip } from "./log-bus.js";
import type { ClientLogPayload, LogLevel } from "./types/log.js";

export const SERVER_VERSION = "0.1.0";

interface ClientCtx {
  socket: WebSocket;
  subs: Set<string>;
}

// Module-level client set so non-WS modules (e.g. log-bus) can broadcast.
// registerWsHub() owns its lifecycle; if not yet registered, broadcast is a no-op.
const clients = new Set<ClientCtx>();

export function broadcast(msg: Record<string, unknown>): void {
  const data = JSON.stringify(msg);
  for (const c of clients) safeSend(c.socket, data);
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

interface OutputQueue {
  chunks: string[];
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
  const msg = JSON.stringify({ type: "output", sessionId, data });
  for (const c of clients) {
    if (c.subs.has(sessionId)) safeSend(c.socket, msg);
  }
}

function enqueueOutput(sessionId: string, data: string): void {
  let q = outputQueues.get(sessionId);
  if (!q) {
    q = { chunks: [], timer: null };
    outputQueues.set(sessionId, q);
  }
  q.chunks.push(data);
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
        if (c.subs.has(sessionId)) safeSend(c.socket, msg);
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
        if (c.subs.has(sessionId)) safeSend(c.socket, msg);
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
