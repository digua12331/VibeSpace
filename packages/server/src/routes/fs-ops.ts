import type { FastifyInstance, FastifyReply } from "fastify";
import { existsSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { getProject } from "../db.js";
import {
  GitServiceError,
  bustStatusCache,
  safeResolve,
  toRepoRelative,
} from "../git-service.js";

const PathBody = z.object({
  path: z.string().min(1).max(4096),
});

const PathQuery = z.object({
  path: z.string().min(1).max(4096),
});

async function loadProjectOr404(
  reply: FastifyReply,
  id: string,
): Promise<{ id: string; path: string } | null> {
  const proj = getProject(id);
  if (!proj) {
    reply.code(404).send({ error: "project_not_found" });
    return null;
  }
  return { id: proj.id, path: proj.path };
}

function sendErr(reply: FastifyReply, err: unknown) {
  if (err instanceof GitServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "fs_failed", message: msg });
}

/**
 * Reveal a file in the platform's native file manager:
 *
 * - Windows: `explorer.exe /select,<abs>` highlights the entry.
 * - macOS:   `open -R <abs>` same.
 * - Linux:   `xdg-open <dirname(abs)>` — there is no select semantic, so we
 *            fall back to opening the parent directory.
 *
 * Fire-and-forget (`detached` + `ref=false`) so the request doesn't wait for
 * the GUI process to exit.
 */
function revealInSystemExplorer(abs: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "win32") {
    cmd = "explorer.exe";
    args = [`/select,${abs}`];
  } else if (platform === "darwin") {
    cmd = "open";
    args = ["-R", abs];
  } else {
    cmd = "xdg-open";
    args = [dirname(abs)];
  }
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.on("error", () => {
    // Swallow — request path already returned { ok: true }; surfacing this
    // failure later would require a different contract. Logged by Fastify
    // internally on the child-process level only if something truly breaks.
  });
  try {
    child.unref();
  } catch {
    // ignore
  }
}

/**
 * Append a single entry to `<projectPath>/.gitignore`, de-duplicating by
 * exact-line match. Returns `true` when a line was actually written.
 */
async function appendGitignoreEntry(
  projectPath: string,
  entry: string,
): Promise<boolean> {
  const target = join(projectPath, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch {
    // file doesn't exist; we'll create it
  }
  const lines = existing.split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry.trim())) return false;
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const payload = `${existing}${needsLeadingNewline ? "\n" : ""}${entry}\n`;
  await writeFile(target, payload, "utf8");
  return true;
}

/** Return 'dir' / 'file' for a path that exists, null otherwise. */
function entryKind(abs: string): "dir" | "file" | null {
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return "dir";
    if (st.isFile()) return "file";
  } catch {
    // fallthrough
  }
  return null;
}

export async function registerFsOpsRoutes(app: FastifyInstance): Promise<void> {
  // ---------- POST /fs/open-folder ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/fs/open-folder",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = PathBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        const abs = safeResolve(proj.path, parsed.data.path);
        if (!existsSync(abs)) {
          return reply.code(404).send({ error: "path_not_found" });
        }
        revealInSystemExplorer(abs);
        return reply.send({ ok: true });
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  // ---------- POST /fs/gitignore-add ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/fs/gitignore-add",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = PathBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        const abs = safeResolve(proj.path, parsed.data.path);
        const rel = toRepoRelative(proj.path, abs);
        if (!rel) {
          return reply
            .code(400)
            .send({ error: "invalid_path", message: "cannot ignore project root" });
        }
        // Dir rules conventionally end with a trailing slash.
        const kind = entryKind(abs);
        const line = kind === "dir" ? `${rel}/` : rel;
        const added = await appendGitignoreEntry(proj.path, line);
        if (added) bustStatusCache(proj.path);
        return reply.send({ added, line });
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );

  // ---------- DELETE /fs/entry?path=... ----------
  app.delete<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/fs/entry",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = PathQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        const abs = safeResolve(proj.path, parsed.data.path);
        const rel = toRepoRelative(proj.path, abs);
        if (!rel) {
          return reply
            .code(400)
            .send({ error: "invalid_path", message: "cannot delete project root" });
        }
        // Extra belt-and-suspenders: refuse to delete if the target is the
        // literal project root, even if safeResolve's relative check was
        // somehow bypassed.
        if (resolvePath(abs) === resolvePath(proj.path)) {
          return reply
            .code(400)
            .send({ error: "invalid_path", message: "cannot delete project root" });
        }
        await rm(abs, { recursive: true, force: false });
        bustStatusCache(proj.path);
        return reply.code(204).send();
      } catch (err) {
        return sendErr(reply, err);
      }
    },
  );
}
