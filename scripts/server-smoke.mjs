#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.AIMON_BASE || "http://127.0.0.1:8787";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";

function fail(step, err) {
  console.error(`[smoke] FAIL @ ${step}:`, err && err.stack ? err.stack : err);
  process.exit(1);
}

async function jsonFetch(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const txt = await res.text();
  let parsed = null;
  if (txt) {
    try { parsed = JSON.parse(txt); } catch { /* leave as text */ }
  }
  return { status: res.status, body: parsed ?? txt };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(maxMs = 15_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > maxMs) throw new Error("health timeout");
    await sleep(200);
  }
}

let cleanupTmp = null;

try {
  console.log(`[smoke] base=${BASE}`);
  await waitForHealth();
  console.log("[smoke] health ok");

  // 1. Create project with a tmp dir
  const baseTmp = mkdtempSync(join(tmpdir(), "aimon-server-smoke-"));
  const projDir = join(baseTmp, "工程目录");
  mkdirSync(projDir, { recursive: true });
  cleanupTmp = baseTmp;
  console.log(`[smoke] proj dir: ${projDir}`);

  const projRes = await jsonFetch("POST", "/api/projects", {
    name: "smoke-test",
    path: projDir,
  });
  if (projRes.status !== 201) fail("create project", JSON.stringify(projRes));
  const projectId = projRes.body.id;
  console.log(`[smoke] project: ${projectId}`);

  // 2. Create session agent=claude
  const sessRes = await jsonFetch("POST", "/api/sessions", {
    projectId,
    agent: "claude",
  });
  if (sessRes.status !== 201) fail("create session", JSON.stringify(sessRes));
  const sessionId = sessRes.body.id;
  const pid = sessRes.body.pid;
  console.log(`[smoke] session: ${sessionId} pid=${pid}`);

  // 3. WS connect, subscribe, await output
  const ws = new WebSocket(WS_URL);
  let helloSeen = false;
  let outputSeen = false;
  let outputBytes = 0;
  let statusSeen = null;
  let exitSeen = null;

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); });
    ws.addEventListener("error", (e) => { clearTimeout(t); reject(new Error("ws error: " + (e.message || ""))); });
  });
  console.log("[smoke] ws open");

  ws.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : ev.data.toString("utf8");
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "hello") {
      helloSeen = true;
      console.log(`[smoke] hello: server v${msg.serverVersion}`);
    } else if (msg.type === "output" && msg.sessionId === sessionId) {
      outputBytes += (msg.data || "").length;
      if (!outputSeen) {
        outputSeen = true;
        const preview = (msg.data || "").slice(0, 60).replace(/\r?\n/g, " ");
        console.log(`[smoke] first output (${msg.data?.length} chars): ${JSON.stringify(preview)}`);
      }
    } else if (msg.type === "status" && msg.sessionId === sessionId) {
      statusSeen = msg.status;
      console.log(`[smoke] status: ${msg.status}`);
    } else if (msg.type === "exit" && msg.sessionId === sessionId) {
      exitSeen = { code: msg.code, signal: msg.signal };
      console.log(`[smoke] exit: code=${msg.code} signal=${msg.signal}`);
    }
  });

  // tiny grace for hello
  await sleep(150);
  if (!helloSeen) fail("hello", "no hello frame");

  ws.send(JSON.stringify({ type: "subscribe", sessionIds: [sessionId] }));

  // 4. Wait for output (claude takes ~1.5s to print banner)
  const outputDeadline = Date.now() + 25_000;
  while (!outputSeen && Date.now() < outputDeadline) await sleep(150);
  if (!outputSeen) fail("await output", "no output frame within 25s");
  console.log(`[smoke] got output, total bytes so far: ${outputBytes}`);

  // 5. Send a benign keystroke (just whitespace) so we don't terminate the session
  const before = outputBytes;
  ws.send(JSON.stringify({ type: "input", sessionId, data: " " }));
  await sleep(800);
  console.log(`[smoke] post-input bytes: ${outputBytes} (delta=${outputBytes - before})`);

  // 6. Verify GET /api/sessions?projectId returns our row
  const listRes = await jsonFetch("GET", `/api/sessions?projectId=${projectId}`);
  if (listRes.status !== 200) fail("list sessions", JSON.stringify(listRes));
  if (!Array.isArray(listRes.body) || !listRes.body.find((r) => r.id === sessionId)) {
    fail("list sessions", "session missing from list: " + JSON.stringify(listRes.body));
  }
  console.log(`[smoke] list ok, ${listRes.body.length} session(s)`);

  // 7. Replay buffer
  ws.send(JSON.stringify({ type: "replay", sessionId }));
  await sleep(400);

  // 8. DELETE session → expect 204
  const delRes = await jsonFetch("DELETE", `/api/sessions/${sessionId}`);
  if (delRes.status !== 204) fail("delete session", JSON.stringify(delRes));
  console.log("[smoke] delete ok");

  // wait briefly for exit broadcast
  const exitDeadline = Date.now() + 5_000;
  while (!exitSeen && Date.now() < exitDeadline) await sleep(150);
  if (!exitSeen) {
    console.warn("[smoke] WARN: no exit frame received within 5s (kill may take longer on Windows)");
  }

  // 9. Cleanup project
  const delProj = await jsonFetch("DELETE", `/api/projects/${projectId}`);
  if (delProj.status !== 200 && delProj.status !== 204) {
    fail("delete project", JSON.stringify(delProj));
  }
  console.log("[smoke] project deleted");

  ws.close();

  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log("=== SERVER SMOKE OK ===");
  process.exit(0);
} catch (err) {
  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  fail("top-level", err);
}
