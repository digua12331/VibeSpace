import { readdir, stat, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getAppSettings } from "./app-settings.js";
import { listProjects } from "./db.js";
import { serverLog } from "./log-bus.js";

/**
 * Project-relative directory pasted images live in. Mirrors the constant in
 * routes/paste-image.ts; kept duplicated here on purpose so the cleaner has
 * no dependency on the route module (which pulls in fastify types).
 */
const REL_DIR = ".vibespace/pasted-images";

interface PruneResult {
  deleted: number;
  scannedProjects: number;
  skippedProjects: number;
  errors: number;
  retentionDays: number;
}

/**
 * Reject any `name` whose resolved absolute path doesn't sit *inside* `absDir`.
 * This is the safety belt for the only place in this feature that calls
 * `unlink` — symlinks, `..`, or hostile filenames must not escape the pasted
 * images directory.
 */
function isInsideDir(absDir: string, name: string): boolean {
  const candidate = resolve(absDir, name);
  const dirWithSep = absDir.endsWith(sep) ? absDir : absDir + sep;
  return candidate.startsWith(dirWithSep);
}

async function pruneOneProject(
  projectPath: string,
  cutoffMs: number,
): Promise<{ deleted: number; errors: number; skipped: boolean }> {
  const absDir = resolve(projectPath, REL_DIR);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT just means this project never received a paste — not an error.
    if (code === "ENOENT") return { deleted: 0, errors: 0, skipped: true };
    return { deleted: 0, errors: 1, skipped: true };
  }

  let deleted = 0;
  let errors = 0;
  for (const name of entries) {
    if (!isInsideDir(absDir, name)) {
      errors += 1;
      continue;
    }
    const full = resolve(absDir, name);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      if (st.mtimeMs < cutoffMs) {
        await unlink(full);
        deleted += 1;
      }
    } catch {
      // Per-file failure is non-fatal — log overall counter and move on.
      errors += 1;
    }
  }
  return { deleted, errors, skipped: false };
}

/**
 * Delete pasted images older than `pasteImageRetentionDays` across every
 * project. Fire-and-forget — callers MUST NOT await it on a hot path. Errors
 * are swallowed into the structured log line so a misbehaving filesystem
 * can never take down the server.
 */
export async function pruneOldPastedImages(): Promise<void> {
  const startedAt = Date.now();
  let retentionDays = 1;
  try {
    retentionDays = getAppSettings().pasteImageRetentionDays;
  } catch (err) {
    serverLog("warn", "cleanup", "paste-images-prune 读取设置失败，回退默认值", {
      meta: { error: { message: (err as Error).message } },
    });
  }

  if (retentionDays <= 0) {
    serverLog("info", "cleanup", "paste-images-prune 跳过 (保留天数=0 关闭清理)", {
      meta: { retentionDays, skipped: true, reason: "retention=off" },
    });
    return;
  }

  serverLog("info", "cleanup", "paste-images-prune 开始", {
    meta: { retentionDays },
  });

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result: PruneResult = {
    deleted: 0,
    scannedProjects: 0,
    skippedProjects: 0,
    errors: 0,
    retentionDays,
  };

  try {
    const projects = listProjects();
    for (const p of projects) {
      const r = await pruneOneProject(p.path, cutoffMs);
      result.deleted += r.deleted;
      result.errors += r.errors;
      if (r.skipped) result.skippedProjects += 1;
      else result.scannedProjects += 1;
    }
    const ms = Date.now() - startedAt;
    serverLog("info", "cleanup", `paste-images-prune 成功 (${ms}ms)`, {
      meta: { ms, ...result },
    });
  } catch (err) {
    const ms = Date.now() - startedAt;
    const e = err as Error;
    serverLog("error", "cleanup", `paste-images-prune 失败: ${e.message}`, {
      meta: {
        ms,
        error: { name: e.name, message: e.message, stack: e.stack },
        ...result,
      },
    });
  }
}
