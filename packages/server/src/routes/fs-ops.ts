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
import { serverLog } from "../log-bus.js";

const HTML_SUFFIX_RE = /\.(html?|xhtml)$/i;

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
 * Hand a file path off to the OS to open with whatever application is
 * registered for its extension (html → default browser). Fire-and-forget, same
 * spirit as revealInSystemExplorer.
 *
 * - Windows: `cmd.exe /c start "" <abs>` — the empty string is `start`'s
 *   title placeholder; without it start would eat the first quoted arg.
 * - macOS:   `open <abs>`   (no -R, so it opens instead of reveals)
 * - Linux:   `xdg-open <abs>`
 */
function openWithDefaultApp(abs: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "win32") {
    cmd = "cmd.exe";
    args = ["/c", "start", "", abs];
  } else if (platform === "darwin") {
    cmd = "open";
    args = [abs];
  } else {
    cmd = "xdg-open";
    args = [abs];
  }
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {
    // swallow — request already returned { ok: true }
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
export async function appendGitignoreEntry(
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
      const startedAt = Date.now();
      const inputPath = parsed.data.path;
      serverLog("info", "fs", "gitignore-add 开始", {
        projectId: proj.id,
        meta: { path: inputPath },
      });
      try {
        const abs = safeResolve(proj.path, inputPath);
        const rel = toRepoRelative(proj.path, abs);
        if (!rel) {
          serverLog("warn", "fs", "gitignore-add 拒绝: 不能忽略项目根", {
            projectId: proj.id,
            meta: { path: inputPath },
          });
          return reply
            .code(400)
            .send({ error: "invalid_path", message: "cannot ignore project root" });
        }
        // Dir rules conventionally end with a trailing slash.
        const kind = entryKind(abs);
        const line = kind === "dir" ? `${rel}/` : rel;
        const added = await appendGitignoreEntry(proj.path, line);
        if (added) bustStatusCache(proj.path);
        serverLog("info", "fs", `gitignore-add 成功 (${Date.now() - startedAt}ms)`, {
          projectId: proj.id,
          meta: { path: inputPath, line, added },
        });
        return reply.send({ added, line });
      } catch (err) {
        serverLog("error", "fs", `gitignore-add 失败: ${(err as Error)?.message ?? String(err)}`, {
          projectId: proj.id,
          meta: {
            path: inputPath,
            ms: Date.now() - startedAt,
            error: { name: (err as Error)?.name, message: (err as Error)?.message },
          },
        });
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
      const startedAt = Date.now();
      const inputPath = parsed.data.path;
      serverLog("info", "fs", "entry-delete 开始", {
        projectId: proj.id,
        meta: { path: inputPath },
      });
      try {
        const abs = safeResolve(proj.path, inputPath);
        const rel = toRepoRelative(proj.path, abs);
        if (!rel) {
          serverLog("warn", "fs", "entry-delete 拒绝: 不能删除项目根", {
            projectId: proj.id,
            meta: { path: inputPath },
          });
          return reply
            .code(400)
            .send({ error: "invalid_path", message: "cannot delete project root" });
        }
        // Extra belt-and-suspenders: refuse to delete if the target is the
        // literal project root, even if safeResolve's relative check was
        // somehow bypassed.
        if (resolvePath(abs) === resolvePath(proj.path)) {
          serverLog("warn", "fs", "entry-delete 拒绝: 不能删除项目根 (resolved)", {
            projectId: proj.id,
            meta: { path: inputPath },
          });
          return reply
            .code(400)
            .send({ error: "invalid_path", message: "cannot delete project root" });
        }
        await rm(abs, { recursive: true, force: false });
        bustStatusCache(proj.path);
        serverLog("info", "fs", `entry-delete 成功 (${Date.now() - startedAt}ms)`, {
          projectId: proj.id,
          meta: { path: inputPath },
        });
        return reply.code(204).send();
      } catch (err) {
        serverLog("error", "fs", `entry-delete 失败: ${(err as Error)?.message ?? String(err)}`, {
          projectId: proj.id,
          meta: {
            path: inputPath,
            ms: Date.now() - startedAt,
            error: { name: (err as Error)?.name, message: (err as Error)?.message },
          },
        });
        return sendErr(reply, err);
      }
    },
  );

  // ---------- POST /fs/open-vscode ----------
  // `code` on Windows is a `.cmd` wrapper, so spawn must go through cmd.exe.
  // We race a 400ms timer against the child's `error` event to surface
  // ENOENT ("code not on PATH") to the caller, instead of the usual
  // fire-and-forget pattern used by revealInSystemExplorer.
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/fs/open-vscode",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      if (!existsSync(proj.path)) {
        return reply.code(404).send({ error: "path_not_found" });
      }
      const child = spawn("cmd.exe", ["/c", "code", proj.path], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      const launched = await new Promise<{ ok: true } | { ok: false; message: string }>(
        (resolvePromise) => {
          const done = (v: { ok: true } | { ok: false; message: string }) => {
            clearTimeout(timer);
            child.removeAllListeners("error");
            resolvePromise(v);
          };
          const timer = setTimeout(() => done({ ok: true }), 400);
          child.once("error", (e) => done({ ok: false, message: e.message }));
        },
      );
      if (launched.ok) {
        try { child.unref(); } catch { /* ignore */ }
        return reply.send({ ok: true });
      }
      return reply
        .code(500)
        .send({ error: "vscode_launch_failed", message: launched.message });
    },
  );

  // ---------- POST /fs/open-in-browser ----------
  // Hand an .html / .htm / .xhtml file to the OS default app (= default
  // browser for these types). Fire-and-forget; errors after launch are not
  // surfaced.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/fs/open-in-browser",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = PathBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const relPath = parsed.data.path;
      if (!HTML_SUFFIX_RE.test(relPath)) {
        serverLog("warn", "fs", "open-in-browser 拒绝: 非 html 后缀", {
          projectId: proj.id,
          meta: { path: relPath },
        });
        return reply.code(400).send({ error: "not_a_html_file" });
      }
      try {
        const abs = safeResolve(proj.path, relPath);
        if (!existsSync(abs)) {
          serverLog("warn", "fs", "open-in-browser 拒绝: 文件不存在", {
            projectId: proj.id,
            meta: { path: relPath },
          });
          return reply.code(404).send({ error: "path_not_found" });
        }
        openWithDefaultApp(abs);
        serverLog("info", "fs", "open-in-browser 成功", {
          projectId: proj.id,
          meta: { path: relPath },
        });
        return reply.send({ ok: true });
      } catch (err) {
        serverLog("error", "fs", "open-in-browser 失败", {
          projectId: proj.id,
          meta: {
            path: relPath,
            error: { message: (err as Error)?.message ?? String(err) },
          },
        });
        return sendErr(reply, err);
      }
    },
  );

}
