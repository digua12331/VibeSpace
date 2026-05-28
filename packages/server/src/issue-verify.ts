import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { serverLog } from "./log-bus.js";

export interface VerifyStep {
  name: string;
  cmd: string;
  args: string[];
  /** Defaults to the worktree path. */
  cwd?: string;
  /** Hard per-step timeout. Default 5 minutes. */
  timeoutMs?: number;
}

export interface VerifyResult {
  ok: boolean;
  /** Name of the first failing step (null when all passed). */
  failedStep: string | null;
  /** Last 1 KB of combined stdout/stderr from the failing step. Empty when ok. */
  errorTail: string;
  /** Full pipeline output, tail-truncated. */
  fullLog: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const ERROR_TAIL_BYTES = 1024;
const FULL_LOG_MAX = 32 * 1024;

function runStep(
  step: VerifyStep,
  worktreePath: string,
  onChunk: (chunk: string) => void,
): Promise<{ ok: boolean; combined: string }> {
  const cwd = step.cwd ?? worktreePath;
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isWin = process.platform === "win32";

  return new Promise((resolve) => {
    const proc = isWin
      ? spawn(step.cmd, step.args, { cwd, shell: true, windowsHide: true })
      : spawn(step.cmd, step.args, { cwd });

    let combined = "";
    const append = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      combined += text;
      onChunk(text);
    };
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      append(`\n[verify-step timed out after ${timeoutMs}ms]\n`);
    }, timeoutMs);
    timer.unref();

    proc.on("error", (err) => {
      append(`\n[spawn error] ${err.message}\n`);
    });
    proc.on("exit", (code, signal) => {
      clearTimeout(timer);
      append(
        `\n[verify-step exit code=${code ?? "null"}${signal ? ` signal=${signal}` : ""}]\n`,
      );
      resolve({ ok: code === 0 && !signal, combined });
    });
  });
}

async function loadProjectPackageScripts(
  projectPath: string,
): Promise<Set<string>> {
  const pkgPath = join(projectPath, "package.json");
  if (!existsSync(pkgPath)) return new Set();
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * Always include tsc-web and tsc-server. Add lint / smoke only when the
 * project root package.json defines those scripts — keeps the pipeline cheap
 * for projects that haven't set them up.
 */
export async function buildVerifySteps(
  projectPath: string,
): Promise<VerifyStep[]> {
  const scripts = await loadProjectPackageScripts(projectPath);
  const steps: VerifyStep[] = [
    {
      name: "tsc-web",
      cmd: "pnpm",
      args: ["-C", "packages/web", "exec", "tsc", "-b", "--force"],
    },
    {
      name: "tsc-server",
      cmd: "pnpm",
      args: ["-C", "packages/server", "exec", "tsc", "-b", "--force"],
    },
  ];
  if (scripts.has("lint")) {
    steps.push({ name: "lint", cmd: "pnpm", args: ["lint"] });
  }
  if (scripts.has("smoke")) {
    steps.push({ name: "smoke", cmd: "pnpm", args: ["smoke"] });
  }
  return steps;
}

/**
 * Run the verify pipeline inside `worktreePath`. Stops at the first failing
 * step. `onChunk` receives streaming output so the issue-job manager can
 * forward it to clients.
 */
export async function runVerify(
  worktreePath: string,
  projectPath: string,
  onChunk: (chunk: string) => void,
): Promise<VerifyResult> {
  const t0 = Date.now();
  const steps = await buildVerifySteps(projectPath);
  let fullLog = "";
  const captureChunk = (text: string): void => {
    fullLog += text;
    if (fullLog.length > FULL_LOG_MAX) {
      const keep = Math.floor(FULL_LOG_MAX / 2);
      fullLog = "…(verify log truncated)…\n" + fullLog.slice(-keep);
    }
    onChunk(text);
  };

  for (const step of steps) {
    captureChunk(`\n=== verify step: ${step.name} ===\n`);
    serverLog("info", "verify", `step start: ${step.name}`, {
      meta: { worktreePath, step: step.name },
    });
    const { ok, combined } = await runStep(step, worktreePath, captureChunk);
    const tail = combined.slice(-ERROR_TAIL_BYTES);
    if (!ok) {
      serverLog("error", "verify", `step failed: ${step.name}`, {
        meta: {
          worktreePath,
          step: step.name,
          errorTail: tail.slice(0, 512),
        },
      });
      return {
        ok: false,
        failedStep: step.name,
        errorTail: tail,
        fullLog,
        durationMs: Date.now() - t0,
      };
    }
    serverLog("info", "verify", `step done: ${step.name}`, {
      meta: { worktreePath, step: step.name },
    });
  }

  return {
    ok: true,
    failedStep: null,
    errorTail: "",
    fullLog,
    durationMs: Date.now() - t0,
  };
}
