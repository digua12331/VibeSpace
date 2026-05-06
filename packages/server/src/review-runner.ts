import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { appendLessons } from "./memory-service.js";
import { jobsService } from "./jobs-service.js";

/** Hard ceiling — abort the CLI child after this. */
const HARD_TIMEOUT_MS = 120_000;
/** Max lesson lines accepted per review. */
const MAX_LESSONS = 5;
/** Max source files listed in the prompt. */
const MAX_FILES_IN_PROMPT = 20;

const LESSON_RE = /^- \[\d{4}-\d{2}-\d{2} \/ [^\]]+\] .+$/;

/**
 * Fire-and-forget: schedule a review job for the just-archived task. Resolves
 * immediately; the archive API does NOT wait.
 */
export function kickoffArchiveReview(
  projectPath: string,
  taskName: string,
  archivedDirName: string,
  projectId?: string,
): void {
  // Register with the global JobsService so the Jobs sidebar tab reflects
  // progress; throwing inside the runner is captured by JobsService and
  // surfaces as state='failed'. The original setImmediate behaviour is
  // preserved (job runs on next tick, register() returns immediately).
  jobsService.register({
    kind: "review",
    title: taskName,
    projectId,
    runner: () => runArchiveReview(projectPath, taskName, archivedDirName),
  });
}

async function runArchiveReview(
  projectPath: string,
  taskName: string,
  archivedDirName: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[review-runner] started ${taskName} (archived as ${archivedDirName})`);
  try {
    const prompt = await buildPrompt(projectPath, taskName, archivedDirName, today);
    const raw = await tryCliChain(prompt);
    const lessons = extractLessons(raw, taskName, today).slice(0, MAX_LESSONS);
    if (lessons.length === 0) {
      console.log(`[review-runner] ${taskName}: 0 lessons extracted (success but empty)`);
      return;
    }
    await appendLessons(projectPath, "auto", lessons);
    console.log(`[review-runner] ${taskName}: appended ${lessons.length} lessons`);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err))
      .replace(/\r?\n/g, " ")
      .trim()
      .slice(0, 300);
    const line = `- [${today} / review-failed:${taskName}] ${msg || "unknown error"}`;
    try {
      await appendLessons(projectPath, "rejected", [line]);
    } catch (inner) {
      console.error(`[review-runner] failed to append rejected entry for ${taskName}:`, inner);
    }
    console.error(`[review-runner] ${taskName} failed: ${msg}`);
  }
}

// ---------- Prompt assembly ----------

async function buildPrompt(
  projectPath: string,
  taskName: string,
  archivedDirName: string,
  today: string,
): Promise<string> {
  const archivedDir = join(projectPath, "dev", "archive", archivedDirName);
  const planMd = await safeRead(join(archivedDir, `${taskName}-plan.md`));
  const contextMd = await safeRead(join(archivedDir, `${taskName}-context.md`));
  const tasksMd = await safeRead(join(archivedDir, `${taskName}-tasks.md`));
  const filesSection = await summarizeChangedFiles(projectPath, archivedDir);

  return [
    'You are reviewing a completed dev task. Your job: extract "lessons" worth carrying to FUTURE tasks in this repo. Cross-task applicability is the only bar — task-specific bug fixes, workarounds, or decisions do NOT qualify.',
    "",
    "Context files (read all before answering):",
    "--- plan.md ---",
    planMd || "(empty)",
    "--- context.md ---",
    contextMd || "(empty)",
    "--- tasks.md ---",
    tasksMd || "(empty)",
    "",
    "Changed source files in this task (each has a short diff summary):",
    filesSection || "(no file summary available)",
    "",
    "Output format — each lesson on ONE line, exactly this shape:",
    "- [<YYYY-MM-DD> / <task-name>] <one-sentence conclusion>（上下文：<why this repeats>）",
    "",
    "Optional structured tag — append at the very end of the line, in this exact form:",
    "  ` [category=<word>; severity=<info|warn|error>; files=<rel,paths,comma-separated>]`",
    "  - category examples: 约定 / 踩坑 / 操作流程 / 性能 / 兼容性 / 测试 / 工具链",
    "  - severity must be exactly one of `info` (普通经验) / `warn` (容易踩坑) / `error` (会真的出故障)",
    "  - files: comma-separated relative paths from repo root; paths must NOT contain commas",
    "  - All three keys are OPTIONAL — omit any field you are unsure about (do NOT guess)",
    "  - Lessons without a tag are still fully accepted",
    "",
    "Rules:",
    "- Write in Chinese (the main repo language).",
    "- Output 0–5 lessons. Empty output is acceptable.",
    "- Each lesson MUST stay on a single line, even with the tag — no wrapping, no markdown tables, no fenced blocks.",
    "- No headings, no code fences, no extra commentary. Just lines starting with `- [`.",
    "- If nothing worth carrying, output: (no lessons)",
    "",
    `Task name: ${taskName}`,
    `Today: ${today}`,
  ].join("\n");
}

async function safeRead(path: string): Promise<string> {
  if (!existsSync(path)) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Best-effort list of source files touched during the task window. We use the
 * archived plan.md's ctime as "task start" and `now` as "task end", then query
 * `git log --since=<start> --name-only`. Any failure collapses to empty string —
 * the prompt gracefully handles a missing section.
 */
async function summarizeChangedFiles(
  projectPath: string,
  archivedDir: string,
): Promise<string> {
  try {
    if (!existsSync(join(projectPath, ".git"))) return "";
    // Find plan.md inside archivedDir.
    const entries = await readdir(archivedDir);
    const planEntry = entries.find((n) => n.endsWith("-plan.md"));
    if (!planEntry) return "";
    const planStat = await stat(join(archivedDir, planEntry));
    const sinceIso = new Date(planStat.mtimeMs).toISOString();
    const git = simpleGit({ baseDir: projectPath, binary: "git", maxConcurrentProcesses: 1 });
    const log = await git.raw([
      "log",
      `--since=${sinceIso}`,
      "--name-only",
      "--pretty=format:",
    ]);
    const files = Array.from(
      new Set(
        log
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith("dev/archive/")),
      ),
    ).slice(0, MAX_FILES_IN_PROMPT);
    if (files.length === 0) return "(no tracked changes in git log window)";
    return files.map((f) => `- ${f}`).join("\n");
  } catch {
    return "";
  }
}

// ---------- CLI invocation chain ----------

async function tryCliChain(prompt: string): Promise<string> {
  const errors: string[] = [];
  try {
    const raw = await runCodex(prompt);
    return raw;
  } catch (err) {
    errors.push(`codex: ${(err as Error).message}`);
    console.warn(`[review-runner] codex failed: ${(err as Error).message} — falling back to gemini`);
  }
  try {
    const raw = await runGemini(prompt);
    return raw;
  } catch (err) {
    errors.push(`gemini: ${(err as Error).message}`);
  }
  throw new Error(errors.join(" | "));
}

async function runCodex(prompt: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "aimon-review-codex-"));
  const outFile = join(workDir, "out.txt");
  try {
    await runCli("codex", [
      "exec",
      "--color", "never",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "-o", outFile,
      "-",
    ], prompt);
    if (!existsSync(outFile)) throw new Error("codex exec produced no output file");
    const body = await readFile(outFile, "utf8");
    if (!body.trim()) throw new Error("codex exec output file is empty");
    return body;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runGemini(prompt: string): Promise<string> {
  // Gemini CLI accepts a prompt via stdin (the `-p -` sigil or bare stdin
  // depending on version — plain stdin works on the versions we support).
  const out = await runCli("gemini", [], prompt, { captureStdout: true });
  const trimmed = out.trim();
  if (!trimmed) throw new Error("gemini produced empty stdout");
  return trimmed;
}

interface RunCliOptions {
  captureStdout?: boolean;
}

async function runCli(
  command: string,
  args: string[],
  stdinPayload: string,
  opts: RunCliOptions = {},
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const done = (err: Error | null, value?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value ?? "");
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      done(new Error(`${command} timed out after ${HARD_TIMEOUT_MS}ms`));
    }, HARD_TIMEOUT_MS);
    child.stdout?.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr?.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => done(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const tail = (stderr || stdout).replace(/\s+/g, " ").trim().slice(-200);
        done(new Error(`${command} exit=${code}${tail ? ` err=${tail}` : ""}`));
        return;
      }
      done(null, opts.captureStdout ? stdout : stdout);
    });
    try {
      child.stdin?.write(stdinPayload);
      child.stdin?.end();
    } catch (err) {
      done(err as Error);
    }
  });
}

// ---------- Lesson extraction ----------

export function extractLessons(raw: string, taskName: string, today: string): string[] {
  const out: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!LESSON_RE.test(line)) continue;
    out.push(normalizeLesson(line, taskName, today));
    if (out.length >= MAX_LESSONS) break;
  }
  return out;
}

/**
 * Keep the model's conclusion but force date and task name to the values the
 * runner knows, so a hallucinated date / task doesn't pollute the memory file.
 */
export function normalizeLesson(line: string, taskName: string, today: string): string {
  const m = /^- \[\d{4}-\d{2}-\d{2} \/ [^\]]+\] (.+)$/.exec(line);
  if (!m) return line;
  return `- [${today} / ${taskName}] ${m[1]}`;
}
