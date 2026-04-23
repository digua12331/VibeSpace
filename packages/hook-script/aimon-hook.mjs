#!/usr/bin/env node
// aimon hook bridge: forwards Claude Code hook events to the aimon backend.
// Usage: node aimon-hook.mjs <eventName>
// Behaviour:
//   - If AIMON_SESSION_ID is not set in env: exit 0 silently (the user is
//     running claude outside of aimon — we MUST NOT slow them down).
//   - For PreToolUse: wait for the POST response so the backend's scope check
//     can return `decision: "block"` which we relay on stdout for Claude.
//   - Other events keep the original fire-and-forget behaviour.
//   - Any network error / timeout / parse failure → fail-open (exit 0, no
//     stdout output) so the AI session never gets stuck on our infra.

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const TIMEOUT_MS = 1500;

function done() {
  process.exit(0);
}

const sessionId = process.env.AIMON_SESSION_ID;
if (!sessionId) done();

const backend = process.env.AIMON_BACKEND || "http://127.0.0.1:8787";
const event = process.argv[2] || "Unknown";
const waitForResponse = event === "PreToolUse";

let stdinChunks = [];
let stdinDone = false;

function relayDecision(respBodyBuf) {
  if (!waitForResponse) return;
  const raw = Buffer.concat(respBodyBuf).toString("utf8").trim();
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed.decision === "block"
  ) {
    // Claude requires decision/reason on stdout as a single JSON blob.
    const payload = { decision: "block", reason: String(parsed.reason ?? "blocked") };
    process.stdout.write(JSON.stringify(payload));
  }
}

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

  const respBody = [];
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
      if (waitForResponse) {
        res.on("data", (c) => respBody.push(c));
      } else {
        res.on("data", () => {});
      }
      res.on("end", () => {
        relayDecision(respBody);
        done();
      });
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
