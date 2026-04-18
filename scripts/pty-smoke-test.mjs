#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);

const SERVER_DIR = new URL("../packages/server/", import.meta.url);
const PTY_PKG_NAME = "@homebridge/node-pty-prebuilt-multiarch";

let pty;
let ptyPkgVersion = "unknown";
try {
  const serverRequire = createRequire(new URL("./package.json", SERVER_DIR));
  pty = serverRequire(PTY_PKG_NAME);
  ptyPkgVersion = serverRequire(`${PTY_PKG_NAME}/package.json`).version;
} catch (err) {
  console.error(`[smoke-test] failed to load ${PTY_PKG_NAME} from packages/server:`, err.message);
  process.exit(1);
}

console.log("[smoke-test] starting...");
console.log(`[smoke-test] pty package: ${PTY_PKG_NAME}@${ptyPkgVersion}`);
console.log(`[smoke-test] node: ${process.version} platform: ${process.platform} arch: ${process.arch}`);

// Create cwd with Chinese characters to verify UTF-8 handling.
const baseTmp = mkdtempSync(join(tmpdir(), "aimon-smoke-"));
const cnDir = join(baseTmp, "测试目录-中文");
mkdirSync(cnDir, { recursive: true });
console.log(`[smoke-test] cwd (cn): ${cnDir}`);

const isWin = process.platform === "win32";
// On Windows, claude/codex installed via npm are .cmd shims. node-pty on
// Windows under ConPTY can spawn them directly when given the .cmd name; we
// resolve the absolute path via PATH lookup.
function resolveCmd(name) {
  const exts = isWin ? [".cmd", ".exe", ".bat", ""] : [""];
  const sep = isWin ? ";" : ":";
  const dirs = (process.env.PATH || "").split(sep);
  for (const d of dirs) {
    if (!d) continue;
    for (const ext of exts) {
      const full = join(d, name + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

function runOne(label, cmdName) {
  return new Promise((resolve) => {
    const resolved = resolveCmd(cmdName);
    if (!resolved) {
      console.log(`[${label}] could not resolve ${cmdName} on PATH`);
      return resolve({ ok: false, error: `not found on PATH: ${cmdName}` });
    }
    console.log(`[${label}] resolved: ${resolved}`);

    const args = ["--version"];
    const start = performance.now();
    let proc;
    try {
      const spawnOpts = {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: cnDir,
        env: { ...process.env, LANG: "en_US.UTF-8" },
      };
      if (isWin) {
        spawnOpts.useConpty = true;
      } else {
        spawnOpts.encoding = "utf8";
      }
      proc = pty.spawn(resolved, args, spawnOpts);
    } catch (err) {
      console.log(`[${label}] spawn threw: ${err.message}`);
      return resolve({ ok: false, error: err.message });
    }

    console.log(`[${label}] spawned pid=${proc.pid}`);

    let buf = "";
    proc.onData((chunk) => {
      buf += chunk;
    });

    const timeout = setTimeout(() => {
      console.log(`[${label}] timeout after 15000ms, killing`);
      try { proc.kill(); } catch {}
    }, 15000);

    proc.onExit(({ exitCode, signal }) => {
      clearTimeout(timeout);
      const durationMs = Math.round(performance.now() - start);
      const trimmed = buf.replace(/\r/g, "").trim();
      console.log(`[${label}] stdout: ${JSON.stringify(trimmed)}`);
      console.log(`[${label}] exit code=${exitCode} signal=${signal ?? "none"} in ${durationMs}ms`);

      // UTF-8 sanity: did process see (and survive) cwd path? We can't echo it
      // from --version output, but the spawn itself succeeding with that cwd
      // is the main UTF-8 boundary in node-pty (winpty/conpty path). Check
      // also that buf decoded without replacement chars.
      const hasReplacement = trimmed.includes("\uFFFD");
      const encodingOk = !hasReplacement;

      resolve({
        ok: exitCode === 0,
        stdout: trimmed,
        exitCode,
        signal: signal ?? null,
        durationMs,
        encoding: encodingOk ? "utf8 ok" : "REPLACEMENT CHAR DETECTED",
        cwd: cnDir,
        resolvedPath: resolved,
      });
    });
  });
}

const result = {
  ptyPackage: `${PTY_PKG_NAME}@${ptyPkgVersion}`,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  useConpty: isWin ? true : null,
  cwdWithCJK: cnDir,
};

result.claude = await runOne("claude", "claude");
result.codex = await runOne("codex", "codex");

console.log("=== RESULT ===");
console.log(JSON.stringify(result, null, 2));

// Cleanup tmp dir.
try { rmSync(baseTmp, { recursive: true, force: true }); } catch {}

const allOk = result.claude.ok && result.codex.ok;
process.exit(allOk ? 0 : 1);
