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
  // Ensure any pending stdout write (e.g. the SessionStart additionalContext
  // JSON, a few hundred bytes) fully flushes before we exit. On Windows when
  // stdout is a pipe, process.exit() can truncate buffered output.
  if (process.stdout.writableLength > 0) {
    process.stdout.once("drain", () => process.exit(0));
    return;
  }
  process.exit(0);
}

const sessionId = process.env.AIMON_SESSION_ID;
if (!sessionId) done();

const backend = process.env.AIMON_BACKEND || "http://127.0.0.1:8787";
const event = process.argv[2] || "Unknown";
const waitForResponse = event === "PreToolUse" || event === "SessionStart";

let stdinChunks = [];
let stdinDone = false;

function relayDecision(respBodyBuf) {
  if (!waitForResponse) return;
  const raw = Buffer.concat(respBodyBuf).toString("utf8").trim();
  if (process.env.AIMON_HOOK_DEBUG) {
    process.stderr.write(`[aimon-hook] relay raw len=${raw.length}\n`);
  }
  if (!raw) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (process.env.AIMON_HOOK_DEBUG) process.stderr.write(`[aimon-hook] parse fail\n`);
    return;
  }
  if (!parsed || typeof parsed !== "object") return;

  if (event === "PreToolUse" && parsed.decision === "block") {
    // Claude requires decision/reason on stdout as a single JSON blob.
    const payload = { decision: "block", reason: String(parsed.reason ?? "blocked") };
    process.stdout.write(JSON.stringify(payload));
    return;
  }

  if (
    event === "SessionStart" &&
    typeof parsed.additionalContext === "string" &&
    parsed.additionalContext.length > 0
  ) {
    // Claude Code honours this shape for SessionStart to prepend system context.
    const payload = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: parsed.additionalContext,
      },
    };
    process.stdout.write(JSON.stringify(payload));
  }
}

function send() {
  if (stdinDone) return;
  stdinDone = true;
  if (process.env.AIMON_HOOK_DEBUG) {
    process.stderr.write(`[aimon-hook] send event=${event} backend=${backend}\n`);
  }

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
setTimeout(() => {
  if (process.env.AIMON_HOOK_DEBUG) {
    process.stderr.write(`[aimon-hook] hard-timeout stdinDone=${stdinDone}\n`);
  }
  done();
}, TIMEOUT_MS).unref();

process.stdin.on("data", (c) => stdinChunks.push(c));
process.stdin.on("end", send);
process.stdin.on("error", send);
// If stdin is a TTY / not piped, end won't fire — kick it manually.
if (process.stdin.isTTY) send();
