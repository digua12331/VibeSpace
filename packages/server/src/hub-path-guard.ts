/**
 * Path / size / binary safety helpers for hub MCP tools that read project
 * files. hub claude can ask "read file X in project Y" — we must not let it
 * escape via `../etc/passwd`, exhaust memory on huge files, or feed binary
 * blobs (incl. credentials in .env-like files) directly into the model.
 *
 * Returned error codes mirror MCP tool error contract — frontend / hub
 * claude can branch on them.
 */
import { resolve, normalize, isAbsolute } from "node:path";
import { stat, readFile } from "node:fs/promises";

export const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
const BINARY_PROBE_BYTES = 8 * 1024;

export type PathGuardError =
  | { code: "invalid_path"; message: string }
  | { code: "path_escape"; message: string };

/**
 * Resolve `relPath` against `projectPath`, reject anything that escapes the
 * project root or that the caller passed as absolute. Returns the absolute
 * resolved path on success.
 *
 * Doesn't check existence — caller does that (so it can distinguish
 * not_found from path_escape in errors).
 */
export function resolveWithinProject(
  projectPath: string,
  relPath: string,
): { ok: true; absPath: string } | { ok: false; error: PathGuardError } {
  if (typeof relPath !== "string" || relPath.length === 0) {
    return {
      ok: false,
      error: { code: "invalid_path", message: "path must be a non-empty string" },
    };
  }
  if (isAbsolute(relPath)) {
    return {
      ok: false,
      error: { code: "path_escape", message: "absolute paths are not allowed" },
    };
  }
  // Normalise to collapse `.` / `..` segments BEFORE join, so we catch
  // `subdir/../..//etc` etc.
  const normalised = normalize(relPath);
  const projectRoot = resolve(projectPath);
  const candidate = resolve(projectRoot, normalised);
  // After resolve, candidate must start with projectRoot + path separator
  // (or equal projectRoot itself — but reading the project root as a file is
  // also wrong; we let stat() return EISDIR for that).
  if (candidate !== projectRoot && !candidate.startsWith(projectRoot + "\\") && !candidate.startsWith(projectRoot + "/")) {
    return {
      ok: false,
      error: { code: "path_escape", message: "path escapes the project root" },
    };
  }
  return { ok: true, absPath: candidate };
}

export type ReadGuardError =
  | { code: "not_found"; message: string }
  | { code: "file_too_large"; message: string; sizeBytes: number; maxBytes: number }
  | { code: "binary_file"; message: string }
  | { code: "read_error"; message: string };

/**
 * Read a file with size + binary guards. Returns the content string on
 * success, or a structured error code on rejection.
 */
export async function readGuarded(
  absPath: string,
): Promise<{ ok: true; content: string; sizeBytes: number } | { ok: false; error: ReadGuardError }> {
  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { ok: false, error: { code: "not_found", message: "file not found" } };
    }
    return {
      ok: false,
      error: { code: "read_error", message: e.message ?? "stat failed" },
    };
  }
  if (!st.isFile()) {
    return {
      ok: false,
      error: { code: "read_error", message: "path is not a regular file" },
    };
  }
  if (st.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: {
        code: "file_too_large",
        message: `file size ${st.size} exceeds ${MAX_FILE_BYTES} byte limit`,
        sizeBytes: st.size,
        maxBytes: MAX_FILE_BYTES,
      },
    };
  }
  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch (err) {
    return {
      ok: false,
      error: { code: "read_error", message: (err as Error).message },
    };
  }
  // Binary heuristic: if any \0 byte in the first 8KB → treat as binary.
  const probe = buf.subarray(0, Math.min(BINARY_PROBE_BYTES, buf.length));
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) {
      return {
        ok: false,
        error: { code: "binary_file", message: "file appears to be binary (\\0 byte in head)" },
      };
    }
  }
  return { ok: true, content: buf.toString("utf8"), sizeBytes: st.size };
}
