#!/usr/bin/env node
// Shell wrapper: runs the TS unit smoke under tsx (which lives in @aimon/server).

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const serverDir = resolve(repoRoot, "packages", "server");
const target = resolve(serverDir, "scripts", "error-pattern-test.ts");

const isWin = process.platform === "win32";
const cmd = isWin ? "pnpm.cmd" : "pnpm";
const proc = spawn(cmd, ["exec", "tsx", target], {
  cwd: serverDir,
  stdio: "inherit",
  env: process.env,
  shell: isWin,
});

proc.on("exit", (code) => process.exit(code ?? 1));
proc.on("error", (err) => {
  process.stderr.write(`[smoke:error-pattern] spawn failed: ${err.message}\n`);
  process.exit(1);
});
