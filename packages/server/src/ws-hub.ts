import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ptyManager } from "./pty-manager.js";
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
 */
export function registerWsHub(app: FastifyInstance): void {
  // ---- PTY → broadcast ----
  ptyManager.on("output", (sessionId: string, data: string) => {
    const msg = JSON.stringify({ type: "output", sessionId, data });
    for (const c of clients) {
      if (c.subs.has(sessionId)) safeSend(c.socket, msg);
    }
  });
  ptyManager.on(
    "exit",
    (sessionId: string, code: number | null, signal: number | null) => {
      const msg = JSON.stringify({ type: "exit", sessionId, code, signal });
      for (const c of clients) {
        if (c.subs.has(sessionId)) safeSend(c.socket, msg);
      }
    },
  );

  // ---- Status → broadcast ----
  statusManager.on(
    "change",
    (sessionId: string, status: SessionStatus, detail?: string) => {
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
