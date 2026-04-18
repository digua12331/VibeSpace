#!/usr/bin/env node
// hooks-smoke: spawn aimon backend, simulate the 6 Claude hook events by POSTing
// /api/hooks/claude, and assert the resulting WS status sequence.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5274"; // distinct from default to avoid clashes
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const SERVER_DIR = resolve(__dirname, "..", "packages", "server");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function jsonFetch(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const txt = await res.text();
  let parsed = null;
  if (txt) { try { parsed = JSON.parse(txt); } catch {} }
  return { status: res.status, body: parsed ?? txt };
}

async function waitHealth(maxMs = 20_000) {
  const start = Date.now();
  for (;;) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch {}
    if (Date.now() - start > maxMs) throw new Error("health timeout");
    await sleep(200);
  }
}

let serverProc = null;
let cleanupTmp = null;

function cleanup() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill("SIGTERM"); } catch {}
  }
  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch {}
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

try {
  console.log(`[hooks-smoke] starting backend on ${BASE}`);
  serverProc = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "src/index.ts"],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, AIMON_PORT: PORT },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  serverProc.stdout.on("data", (b) => process.stdout.write(`[srv] ${b}`));
  serverProc.stderr.on("data", (b) => process.stderr.write(`[srv!] ${b}`));
  serverProc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[hooks-smoke] server died early code=${code}`);
    }
  });

  await waitHealth();
  console.log("[hooks-smoke] health ok");

  // Create project (path must exist) — use a tmp dir.
  cleanupTmp = mkdtempSync(join(tmpdir(), "aimon-hooks-smoke-"));
  const projDir = join(cleanupTmp, "proj");
  mkdirSync(projDir, { recursive: true });

  const proj = await jsonFetch("POST", "/api/projects", { name: "hooks-smoke", path: projDir });
  if (proj.status !== 201) throw new Error("create project: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[hooks-smoke] project ${projectId}`);

  // Try to create a real claude session, but if the binary isn't on PATH, fall back
  // to a synthetic session id (we only need the id for hook routing — the status
  // machine doesn't require a live PTY).
  let sessionId;
  const sess = await jsonFetch("POST", "/api/sessions", { projectId, agent: "claude" });
  if (sess.status === 201) {
    sessionId = sess.body.id;
    console.log(`[hooks-smoke] real session ${sessionId} pid=${sess.body.pid}`);
  } else {
    sessionId = "synthetic-" + Math.random().toString(36).slice(2, 12);
    console.log(`[hooks-smoke] no real claude (status ${sess.status}), using synthetic id ${sessionId}`);
  }

  // Open WS, subscribe, collect status frames *after* subscribe.
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("ws open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(t); res(); });
    ws.addEventListener("error", (e) => { clearTimeout(t); rej(new Error("ws error " + (e.message || ""))); });
  });

  const statuses = [];
  ws.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : ev.data.toString("utf8");
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "status" && msg.sessionId === sessionId) {
      statuses.push({ status: msg.status, detail: msg.detail });
      console.log(`[hooks-smoke] ws status: ${msg.status}${msg.detail ? " (" + msg.detail + ")" : ""}`);
    }
  });

  // Subscribe — this may emit current status (e.g. 'starting') which we will
  // discard from our assertion window.
  ws.send(JSON.stringify({ type: "subscribe", sessionIds: [sessionId] }));
  await sleep(300);
  const baselineLen = statuses.length;
  console.log(`[hooks-smoke] subscribed; baseline frames=${baselineLen}`);

  const events = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
  ];

  for (const ev of events) {
    const payload = ev === "Notification" ? { message: "claude needs input" } : { test: true };
    const r = await jsonFetch("POST", "/api/hooks/claude", { sessionId, event: ev, payload });
    if (r.status !== 200 || !r.body || r.body.ok !== true) {
      throw new Error(`hook POST ${ev} bad: ${JSON.stringify(r)}`);
    }
    await sleep(200);
  }

  // Allow last frame to settle.
  await sleep(300);

  const newFrames = statuses.slice(baselineLen).map((s) => s.status);
  console.log(`[hooks-smoke] new frames after hooks: [${newFrames.join(", ")}]`);

  // Expected sequence: working (UserPromptSubmit) → (PreToolUse same, dedup'd) → (PostToolUse same, dedup'd) → waiting_input → idle
  // Our StatusMachine dedups consecutive identical states. So expected is: working, waiting_input, idle.
  // SessionStart is a no-op.
  const expected = ["working", "waiting_input", "idle"];
  const ok = expected.length === newFrames.length &&
    expected.every((v, i) => v === newFrames[i]);
  if (!ok) {
    throw new Error(`status sequence mismatch. expected [${expected.join(",")}] got [${newFrames.join(",")}]`);
  }

  ws.close();
  console.log("=== HOOKS SMOKE OK ===");
  process.exit(0);
} catch (err) {
  console.error("[hooks-smoke] FAIL:", err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
}
