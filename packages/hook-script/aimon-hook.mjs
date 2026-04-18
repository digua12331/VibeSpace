#!/usr/bin/env node
// aimon hook bridge: forwards Claude Code hook events to the aimon backend.
// Usage: node aimon-hook.mjs <eventName>
// Behaviour:
//   - If AIMON_SESSION_ID is not set in env: exit 0 silently (the user is
//     running claude outside of aimon — we MUST NOT slow them down).
//   - Otherwise read stdin (JSON or empty), POST to ${AIMON_BACKEND}/api/hooks/claude.
//   - Any error (timeout / refused / parse) is swallowed. Always exit 0.

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const TIMEOUT_MS = 1500;

function done() {
  // Always 0 — we cannot block claude on our backend.
  process.exit(0);
}

const sessionId = process.env.AIMON_SESSION_ID;
if (!sessionId) done();

const backend = process.env.AIMON_BACKEND || "http://127.0.0.1:8787";
const event = process.argv[2] || "Unknown";

let stdinChunks = [];
let stdinDone = false;

function send() {
  if (stdinDone) return;
  stdinDone = true;

  let payload = null;
  const raw = Buffer.concat(stdinChunks).toString("utf8").trim();
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  }

  const body = JSON.stringify({ sessionId, event, payload });

  let url;
  try { url = new URL("/api/hooks/claude", backend); } catch { return done(); }
  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      timeout: TIMEOUT_MS,
    },
    (res) => {
      res.on("data", () => {});
      res.on("end", done);
      res.on("error", done);
    },
  );
  req.on("error", done);
  req.on("timeout", () => { try { req.destroy(); } catch {} done(); });
  req.write(body);
  req.end();
}

// Hard ceiling so we never exceed ~1.5s.
setTimeout(done, TIMEOUT_MS).unref();

process.stdin.on("data", (c) => stdinChunks.push(c));
process.stdin.on("end", send);
process.stdin.on("error", send);
// If stdin is a TTY / not piped, end won't fire — kick it manually.
if (process.stdin.isTTY) send();
