import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { serverLog } from "./log-bus.js";

export type StatusEntryKind =
  | "STEP_DONE"
  | "STEP_FAIL"
  | "CUTOFF"
  | "RESUME"
  | "NOTE";

export interface StatusEntry {
  kind: StatusEntryKind;
  at: number;
  sessionId?: string | null;
  /** Step id from tasks.json (number) or arbitrary tag (string). */
  step?: string | number;
  /** Subtask id when this entry belongs to a parallel-dispatched subtask. */
  subtaskId?: number;
  note?: string;
  /** Cutoff reason code (e.g. 'rounds-exceeded'). */
  reason?: string;
  /** Human-readable explanation. */
  message?: string;
  /** Suggested next step for the resuming session. */
  nextStep?: string;
  budget?: {
    rounds: number;
    elapsedMinutes: number;
    tokensApprox: number;
  };
}

const STATUS_FILE_NAME = "STATUS.md";
const STATUS_HEADER = `# 任务自动状态

> append-only log，每个块代表一次状态变更。Runtime 数据，加入 .gitignore 不入库。
> 字段：kind / sessionId / step / reason / message / nextStep / budget。
> 接力时新会话的 SessionStart hook 会自动读末尾若干字节注入提示词，不需要大哥手动操作。

---
`;

function statusPath(projectPath: string, taskName: string): string {
  return join(projectPath, "dev", "active", taskName, STATUS_FILE_NAME);
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatEntry(entry: StatusEntry): string {
  const lines: string[] = [];
  lines.push(`## ${formatTimestamp(entry.at)} · ${entry.kind}`);
  if (entry.sessionId) lines.push(`- sessionId: ${entry.sessionId}`);
  if (entry.subtaskId !== undefined) lines.push(`- subtask: ${entry.subtaskId}`);
  if (entry.step !== undefined) lines.push(`- step: ${entry.step}`);
  if (entry.reason) lines.push(`- reason: ${entry.reason}`);
  if (entry.message) lines.push(`- message: ${entry.message}`);
  if (entry.nextStep) lines.push(`- nextStep: ${entry.nextStep}`);
  if (entry.note) lines.push(`- note: ${entry.note}`);
  if (entry.budget) {
    const { rounds, elapsedMinutes, tokensApprox } = entry.budget;
    lines.push(
      `- budget: rounds=${rounds} elapsed=${Math.round(elapsedMinutes)}min tokens≈${tokensApprox}`,
    );
  }
  lines.push("");
  return lines.join("\n") + "\n";
}

/**
 * Append a status entry to `<projectPath>/dev/active/<taskName>/STATUS.md`.
 * Uses fs.appendFile (POSIX O_APPEND, atomic at the OS level so concurrent
 * sessions don't clobber each other). Creates the file with a header on first
 * write. If the task directory doesn't exist, logs a warning and skips silently
 * — the file is runtime-only, so it shouldn't block the main flow.
 */
export async function appendStatusEntry(
  projectPath: string,
  taskName: string,
  entry: StatusEntry,
): Promise<void> {
  const path = statusPath(projectPath, taskName);
  const dir = dirname(path);
  try {
    if (!existsSync(dir)) {
      serverLog(
        "warn",
        "status",
        `task dir missing, skip status append: ${taskName}`,
        { meta: { path: dir } },
      );
      return;
    }
    if (!existsSync(path)) {
      // First write: header + entry in one atomic append.
      await appendFile(path, STATUS_HEADER + formatEntry(entry), "utf8");
    } else {
      await appendFile(path, formatEntry(entry), "utf8");
    }
  } catch (err) {
    serverLog(
      "error",
      "status",
      `appendStatusEntry failed: ${(err as Error).message}`,
      { meta: { taskName, path, error: { message: (err as Error).message } } },
    );
  }
}

/**
 * Read the tail of `STATUS.md` for injection into a fresh session's prompt.
 * Returns the **last `maxBytes` bytes** of the file, byte-accurate
 * (UTF-8 safe — slices at line boundaries from the end backwards). Empty
 * string if the file doesn't exist.
 */
export async function readStatusSummary(
  projectPath: string,
  taskName: string,
  maxBytes = 3 * 1024,
): Promise<string> {
  const path = statusPath(projectPath, taskName);
  if (!existsSync(path)) return "";
  try {
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw, "utf8") <= maxBytes) return raw;
    // Tail-truncate at a line boundary.
    let cut = raw.length;
    while (
      cut > 0 &&
      Buffer.byteLength(raw.slice(raw.length - cut), "utf8") > maxBytes
    ) {
      cut -= 256;
    }
    const tail = raw.slice(raw.length - cut);
    // Walk forward to the next "## " header so we don't cut mid-block.
    const headerIdx = tail.indexOf("\n## ");
    const aligned = headerIdx >= 0 ? tail.slice(headerIdx + 1) : tail;
    return "... (truncated; see full file for history)\n\n" + aligned;
  } catch (err) {
    serverLog(
      "warn",
      "status",
      `readStatusSummary failed: ${(err as Error).message}`,
      { meta: { taskName, path } },
    );
    return "";
  }
}

/**
 * Ensure `<projectPath>/dev/active/<taskName>/` exists. Called when a task
 * is first registered with the BudgetManager — defensive against missing
 * dirs in tests / fresh setups. Real tasks always have the dir already.
 */
export async function ensureTaskDir(
  projectPath: string,
  taskName: string,
): Promise<void> {
  const dir = join(projectPath, "dev", "active", taskName);
  try {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  } catch (err) {
    serverLog(
      "warn",
      "status",
      `ensureTaskDir failed: ${(err as Error).message}`,
      { meta: { dir } },
    );
  }
}
