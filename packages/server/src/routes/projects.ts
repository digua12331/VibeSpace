import type { FastifyInstance } from "fastify";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  createProject,
  deleteProject as dbDeleteProject,
  getProject,
  listProjects,
  listSessionsByProject,
  endSession,
  updateProjectLayout,
} from "../db.js";
import { ptyManager } from "../pty-manager.js";
import {
  DEV_DOCS_GUIDELINES,
  ISSUES_ARCHIVE_SECTION,
} from "../dev-docs-guidelines.js";
import { removeWorktree } from "../git-service.js";
import { serverLog } from "../log-bus.js";
import { listSkills } from "../skills-service.js";
import {
  applyHarnessTemplate,
  getHarnessStatus,
  isHarnessApplied,
  uninstallHarnessTemplate,
} from "../harness-template-service.js";

const DEFAULT_ROOT = "F:\\VibeSpace";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1).optional(),
});

/**
 * Append `body` to <projectPath>/CLAUDE.md, guarding against:
 * - duplicate application (by a stable anchor line),
 * - awkward newline boundaries between existing content and the appended body.
 *
 * Returns `true` when the file was written, `false` when it was already present.
 */
function appendToClaudeMd(
  projectPath: string,
  body: string,
  anchor: string,
): boolean {
  const target = join(projectPath, "CLAUDE.md");
  let existing = "";
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    // file does not exist — write fresh
  }
  if (anchor && existing.includes(anchor)) return false;
  const needsSeparator = existing.length > 0;
  const trailingNewlines = existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  const payload = needsSeparator
    ? `${existing}${trailingNewlines}---\n\n${body}`
    : body;
  writeFileSync(target, payload, "utf8");
  return true;
}

const MAIN_GUIDELINES_ANCHOR = "# Dev Docs 工作流";
const ISSUES_SECTION_ANCHOR = "## Issues 档案";

/**
 * Insert `section` into the main guidelines block when the block exists but is
 * missing that section. "The block" is the chunk of CLAUDE.md starting at
 * `mainAnchor` and ending at the **first `---` on its own line after the main
 * anchor** (the same separator `appendToClaudeMd` adds between appended bodies)
 * or end-of-file, whichever comes first. The section is appended to the end of
 * that block with a blank-line separator, preserving any user-authored content
 * in between.
 *
 * Returns `true` if a write happened, `false` if the section was already there
 * or the main block is missing entirely.
 */
function insertSectionBeforeSeparator(
  projectPath: string,
  section: string,
  sectionAnchor: string,
  mainAnchor: string,
): boolean {
  const target = join(projectPath, "CLAUDE.md");
  let existing: string;
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    return false;
  }
  const mainIdx = existing.indexOf(mainAnchor);
  if (mainIdx < 0) return false;

  // Locate the end of the main block: the first standalone `---` separator
  // after the main anchor, or EOF.
  const afterMain = existing.slice(mainIdx);
  const sepMatch = /\n---\s*\n/.exec(afterMain);
  const blockEndRel = sepMatch ? sepMatch.index + 1 : afterMain.length;
  const block = afterMain.slice(0, blockEndRel);

  if (block.includes(sectionAnchor)) return false;

  // Trim trailing whitespace of the block, then re-attach with one blank line
  // before the inserted section so headings aren't glued together.
  const blockTrimmed = block.replace(/\s+$/, "");
  const rebuiltBlock = `${blockTrimmed}\n\n${section.trimEnd()}\n`;
  const rebuilt =
    existing.slice(0, mainIdx) +
    rebuiltBlock +
    afterMain.slice(blockEndRel);
  writeFileSync(target, rebuilt, "utf8");
  return true;
}

function appendDevDocsGuidelines(projectPath: string): boolean {
  // Stable anchor so re-applying is a no-op even if user edits surrounding text.
  const wroteFull = appendToClaudeMd(
    projectPath,
    DEV_DOCS_GUIDELINES,
    MAIN_GUIDELINES_ANCHOR,
  );
  if (wroteFull) return true;
  // Main block was already present — upgrade by inserting any missing sections.
  return insertSectionBeforeSeparator(
    projectPath,
    ISSUES_ARCHIVE_SECTION,
    ISSUES_SECTION_ANCHOR,
    MAIN_GUIDELINES_ANCHOR,
  );
}

const LayoutSchema = z.object({
  cols: z.number().int().min(1).max(48),
  rowHeight: z.number().int().min(10).max(400),
  tiles: z.array(
    z.object({
      i: z.string().min(1),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
      minW: z.number().int().min(1).optional(),
      minH: z.number().int().min(1).optional(),
    }),
  ),
});

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects", async () => {
    return listProjects();
  });

  app.post("/api/projects", async (req, reply) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { name, path: rawPath } = parsed.data;
    const pathMode: "auto" | "custom" = rawPath ? "custom" : "auto";
    const path = rawPath ?? join(DEFAULT_ROOT, name);

    const t0 = Date.now();
    serverLog("info", "project", "project-create 开始", {
      meta: { name, path, pathMode },
    });

    if (pathMode === "auto") {
      try {
        mkdirSync(path, { recursive: true });
      } catch (err) {
        const msg = (err as Error).message || "mkdir failed";
        serverLog("error", "project", `project-create 失败: ${msg}`, {
          meta: {
            name,
            path,
            pathMode,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return reply.code(400).send({ error: "path_unwritable", path });
      }
    } else {
      try {
        const st = statSync(path);
        if (!st.isDirectory()) {
          serverLog(
            "error",
            "project",
            "project-create 失败: path_not_directory",
            { meta: { name, path, pathMode } },
          );
          return reply.code(400).send({ error: "path_not_directory", path });
        }
      } catch {
        serverLog("error", "project", "project-create 失败: path_not_found", {
          meta: { name, path, pathMode },
        });
        return reply.code(400).send({ error: "path_not_found", path });
      }
    }

    try {
      const proj = createProject({ id: nanoid(12), name, path });
      serverLog(
        "info",
        "project",
        `project-create 成功 (${Date.now() - t0}ms)`,
        {
          projectId: proj.id,
          meta: { name, path, pathMode },
        },
      );
      return reply.code(201).send(proj);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("UNIQUE") || msg.includes("constraint")) {
        serverLog(
          "error",
          "project",
          "project-create 失败: path_already_exists",
          { meta: { name, path, pathMode } },
        );
        return reply.code(409).send({ error: "path_already_exists", path });
      }
      serverLog("error", "project", `project-create 失败: ${msg}`, {
        meta: {
          name,
          path,
          pathMode,
          error: { name: (err as Error).name, message: msg },
        },
      });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/apply-harness",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "apply-harness 开始", {
        projectId: proj.id,
        meta: { source: "drawer" },
      });
      try {
        const r = await applyHarnessTemplate(proj.path);
        serverLog(
          "info",
          "project",
          `apply-harness 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              source: "drawer",
              copied: r.copied.length,
              skipped: r.skipped.length,
              gitignoreAppended: r.gitignoreAppended,
            },
          },
        );
        return reply.send(r);
      } catch (err) {
        const msg = (err as Error).message || "apply-harness failed";
        serverLog("error", "project", `apply-harness 失败: ${msg}`, {
          projectId: proj.id,
          meta: {
            source: "drawer",
            error: { name: (err as Error).name, message: msg },
          },
        });
        return reply.code(500).send({ error: "apply_failed", detail: msg });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id/harness",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "harness-uninstall 开始", {
        projectId: proj.id,
      });
      try {
        const r = await uninstallHarnessTemplate(proj.path);
        if (r.failedFiles.length > 0) {
          serverLog(
            "error",
            "project",
            `harness-uninstall 部分失败 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: {
                removedCount: r.removedCount,
                skippedCount: r.skippedCount,
                failedCount: r.failedFiles.length,
              },
            },
          );
          return reply.code(207).send({ ok: false, ...r });
        }
        serverLog(
          "info",
          "project",
          `harness-uninstall 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              removedCount: r.removedCount,
              skippedCount: r.skippedCount,
            },
          },
        );
        return reply.send({ ok: true, ...r });
      } catch (err) {
        const msg = (err as Error).message || "harness-uninstall failed";
        serverLog("error", "project", `harness-uninstall 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "uninstall_failed", detail: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/harness-status",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      try {
        const status = await getHarnessStatus(proj.path);
        return status;
      } catch (err) {
        return reply.code(500).send({
          error: "status_failed",
          detail: (err as Error).message,
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/harness-applied",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "harness-status 开始", {
        projectId: proj.id,
      });
      try {
        const enabled = isHarnessApplied(proj.path);
        serverLog(
          "info",
          "project",
          `harness-status 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: { enabled },
          },
        );
        return reply.send({ enabled });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "project", `harness-status 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "read_failed", message: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/layout",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      return proj.layout ?? null;
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/layout",
    async (req, reply) => {
      const parsed = LayoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const ok = updateProjectLayout(req.params.id, {
        ...parsed.data,
        updatedAt: Date.now(),
      });
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/skills",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const skills = await listSkills(proj.path);
      // Wire shape omits body to keep response small.
      return skills.map((s) => ({ name: s.name, triggers: s.triggers }));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/apply-dev-docs",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      try {
        const wrote = appendDevDocsGuidelines(proj.path);
        return reply.send({
          ok: true,
          wrote,
          target: join(proj.path, "CLAUDE.md"),
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        return reply.code(500).send({ error: "write_failed", message: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/dev-docs-status",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "dev-docs-status 开始", {
        projectId: proj.id,
      });
      try {
        const target = join(proj.path, "CLAUDE.md");
        let claudeMdExists = true;
        let content = "";
        try {
          content = readFileSync(target, "utf8");
        } catch {
          claudeMdExists = false;
        }
        const enabled =
          claudeMdExists && content.indexOf(MAIN_GUIDELINES_ANCHOR) >= 0;
        serverLog(
          "info",
          "project",
          `dev-docs-status 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: { enabled, claudeMdExists },
          },
        );
        return reply.send({ enabled, claudeMdExists });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "project", `dev-docs-status 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "read_failed", message: msg });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id/dev-docs",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "dev-docs-remove 开始", {
        projectId: proj.id,
      });
      try {
        const target = join(proj.path, "CLAUDE.md");
        let content: string;
        try {
          content = readFileSync(target, "utf8");
        } catch {
          serverLog(
            "info",
            "project",
            `dev-docs-remove 成功 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: { changed: false, reason: "claude_md_missing" },
            },
          );
          return reply.send({ ok: true, enabled: false });
        }
        const REMOVE_PREFIX = "\n\n---\n\n" + MAIN_GUIDELINES_ANCHOR;
        const idx = content.indexOf(REMOVE_PREFIX);
        if (idx < 0) {
          serverLog(
            "info",
            "project",
            `dev-docs-remove 成功 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: { changed: false, reason: "anchor_missing" },
            },
          );
          return reply.send({ ok: true, enabled: false });
        }
        const trimmed = content.slice(0, idx).replace(/\s+$/, "");
        writeFileSync(target, trimmed + "\n", "utf8");
        serverLog(
          "info",
          "project",
          `dev-docs-remove 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: { changed: true },
          },
        );
        return reply.send({ ok: true, enabled: false });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "project", `dev-docs-remove 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "write_failed", message: msg });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (req, reply) => {
      const { id } = req.params;
      const proj = getProject(id);
      if (!proj) return reply.code(404).send({ error: "not_found" });

      // Kill any live sessions for this project, then mark them stopped, and
      // GC their worktrees (if any) so server data/worktrees/<projectId>/ is
      // emptied alongside the project row.
      const sessions = listSessionsByProject(id);
      for (const s of sessions) {
        if (ptyManager.isAlive(s.id)) {
          ptyManager.kill(s.id);
          endSession(s.id, "stopped", null);
        }
        if (s.isolation === "worktree" && s.worktreePath) {
          try {
            await removeWorktree(proj.path, s.worktreePath, { force: true });
          } catch (err) {
            // Don't block project delete on a residual worktree directory —
            // log a warning and move on.
            serverLog(
              "warn",
              "git",
              `worktree-remove (project delete) 失败: ${(err as Error).message}`,
              {
                projectId: id,
                sessionId: s.id,
                meta: { worktreePath: s.worktreePath },
              },
            );
          }
        }
      }
      const ok = dbDeleteProject(id);
      return reply.send({ ok, id });
    },
  );
}
