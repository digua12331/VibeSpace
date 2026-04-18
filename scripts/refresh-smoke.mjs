#!/usr/bin/env node
// refresh-smoke: simulate a browser page refresh.
// Assumes server is already running on AIMON_BASE (default 8787).
//
// Steps:
//   1) GET /api/health
//   2) Create project + claude session
//   3) Open WS #1, subscribe, wait for first output (the "live" tab)
//   4) Open WS #2 (the "refreshed" tab) — list sessions, re-subscribe to alive
//      ones, request replay → expect a status frame and a non-empty replay
//   5) Cleanup (DELETE session + project)

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.AIMON_BASE || "http://127.0.0.1:8787";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";

function fail(step, err) {
  console.error(`[refresh] FAIL @ ${step}:`, err && err.stack ? err.stack : err);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonFetch(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const txt = await res.text();
  let parsed = null;
  if (txt) { try { parsed = JSON.parse(txt); } catch { /* leave as text */ } }
  return { status: res.status, body: parsed ?? txt };
}

async function waitOpen(ws) {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); });
    ws.addEventListener("error", (e) => { clearTimeout(t); reject(new Error("ws error: " + (e?.message || ""))); });
  });
}

let cleanupTmp = null;
let ws1 = null;
let ws2 = null;

try {
  console.log(`[refresh] base=${BASE}`);
  const h = await jsonFetch("GET", "/api/health");
  if (h.status !== 200) fail("health", JSON.stringify(h));
  console.log(`[refresh] health ok v${h.body.version}`);

  const baseTmp = mkdtempSync(join(tmpdir(), "aimon-refresh-"));
  const projDir = join(baseTmp, "proj");
  mkdirSync(projDir, { recursive: true });
  cleanupTmp = baseTmp;

  const proj = await jsonFetch("POST", "/api/projects", { name: "refresh-test", path: projDir });
  if (proj.status !== 201) fail("create project", JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[refresh] project ${projectId}`);

  const sess = await jsonFetch("POST", "/api/sessions", { projectId, agent: "claude" });
  if (sess.status !== 201) fail("create session", JSON.stringify(sess));
  const sessionId = sess.body.id;
  console.log(`[refresh] session ${sessionId} pid=${sess.body.pid}`);

  // ---- Tab #1: original "live" view ----
  ws1 = new WebSocket(WS_URL);
  let ws1Output = 0;
  ws1.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : ev.data.toString("utf8");
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "output" && msg.sessionId === sessionId) ws1Output += msg.data.length;
  });
  await waitOpen(ws1);
  ws1.send(JSON.stringify({ type: "subscribe", sessionIds: [sessionId] }));
  // Give claude time to print its banner so the server-side buffer is non-empty.
  const ws1Deadline = Date.now() + 25_000;
  while (ws1Output < 50 && Date.now() < ws1Deadline) await sleep(150);
  if (ws1Output < 50) fail("ws1 output", `only ${ws1Output} bytes from initial banner`);
  console.log(`[refresh] ws1 saw ${ws1Output} bytes from live session`);

  // ---- Simulate a page refresh: listSessions + brand-new WS + subscribe + replay ----
  const list = await jsonFetch("GET", "/api/sessions");
  if (list.status !== 200) fail("list", JSON.stringify(list));
  const alive = list.body.filter((r) => r.ended_at == null);
  if (!alive.find((r) => r.id === sessionId)) fail("post-refresh list", "alive session missing");
  console.log(`[refresh] post-refresh list: ${alive.length} alive session(s)`);

  ws2 = new WebSocket(WS_URL);
  let ws2Status = null;
  let ws2ReplayBytes = 0;
  let ws2Hello = false;
  ws2.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : ev.data.toString("utf8");
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "hello") ws2Hello = true;
    if (msg.type === "status" && msg.sessionId === sessionId) ws2Status = msg.status;
    if (msg.type === "replay" && msg.sessionId === sessionId) ws2ReplayBytes = (msg.data || "").length;
  });
  await waitOpen(ws2);
  ws2.send(JSON.stringify({ type: "subscribe", sessionIds: alive.map((r) => r.id) }));
  ws2.send(JSON.stringify({ type: "replay", sessionId }));
  const ws2Deadline = Date.now() + 5_000;
  while ((!ws2Status || ws2ReplayBytes === 0) && Date.now() < ws2Deadline) await sleep(150);
  if (!ws2Hello) fail("ws2 hello", "no hello frame on the refreshed tab");
  if (!ws2Status) fail("ws2 status", "no status frame after re-subscribe — server didn't push current status");
  if (ws2ReplayBytes === 0) fail("ws2 replay", "replay buffer was empty after refresh");
  console.log(`[refresh] ws2 (refreshed tab): hello=${ws2Hello} status=${ws2Status} replay=${ws2ReplayBytes} bytes`);

  // ---- Cleanup ----
  ws1.close();
  ws2.close();
  ws1 = null; ws2 = null;
  const del = await jsonFetch("DELETE", `/api/sessions/${sessionId}`);
  if (del.status !== 204) console.warn(`[refresh] WARN delete session: ${del.status}`);
  const delProj = await jsonFetch("DELETE", `/api/projects/${projectId}`);
  if (delProj.status !== 200 && delProj.status !== 204) console.warn(`[refresh] WARN delete project: ${delProj.status}`);

  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  console.log("=== REFRESH SMOKE OK ===");
  process.exit(0);
} catch (err) {
  if (ws1) try { ws1.close(); } catch { /* ignore */ }
  if (ws2) try { ws2.close(); } catch { /* ignore */ }
  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  fail("top-level", err);
}
