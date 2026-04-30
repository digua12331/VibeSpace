import type { FastifyInstance } from "fastify";
import { mkdirSync, statSync } from "node:fs";
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
import { removeWorktree } from "../git-service.js";
import { serverLog } from "../log-bus.js";
import { listSkills } from "../skills-service.js";
import {
  applyWorkflowToProject,
  getWorkflowStatus,
  removeWorkflowFromProject,
} from "../workflow-service.js";

const DEFAULT_ROOT = "F:\\VibeSpace";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1).optional(),
});

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
    "/api/projects/:id/workflow",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "apply-workflow 开始", {
        projectId: proj.id,
      });
      try {
        const r = await applyWorkflowToProject(proj.path);
        const devDocsOk = r.devDocs.ok;
        const harnessOk = r.harness !== null && r.harness.ok === true;
        if (!devDocsOk || (r.harness && !harnessOk)) {
          // Either step failed; report as 207 (partial) so UI can branch.
          serverLog(
            "error",
            "project",
            `apply-workflow 部分失败 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: {
                devDocsOk,
                harnessOk,
                partial: r.partial,
              },
            },
          );
          return reply.code(207).send(r);
        }
        serverLog(
          "info",
          "project",
          `apply-workflow 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              devDocsWrote: r.devDocs.ok ? r.devDocs.wrote : false,
              harnessCopied:
                r.harness && r.harness.ok ? r.harness.copied.length : 0,
              harnessSkipped:
                r.harness && r.harness.ok ? r.harness.skipped.length : 0,
            },
          },
        );
        return reply.send(r);
      } catch (err) {
        const msg = (err as Error).message || "apply-workflow failed";
        serverLog("error", "project", `apply-workflow 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "apply_failed", detail: msg });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id/workflow",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "remove-workflow 开始", {
        projectId: proj.id,
      });
      try {
        const r = await removeWorkflowFromProject(proj.path);
        if (r.partial) {
          serverLog(
            "error",
            "project",
            `remove-workflow 部分失败 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: {
                devDocsChanged: r.devDocs.changed,
                harnessRemoved: r.harness.removedCount,
                harnessSkipped: r.harness.skippedCount,
                harnessFailed: r.harness.failedFiles.length,
              },
            },
          );
          return reply.code(207).send({ ok: false, ...r });
        }
        serverLog(
          "info",
          "project",
          `remove-workflow 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              devDocsChanged: r.devDocs.changed,
              harnessRemoved: r.harness.removedCount,
              harnessSkipped: r.harness.skippedCount,
            },
          },
        );
        return reply.send({ ok: true, ...r });
      } catch (err) {
        const msg = (err as Error).message || "remove-workflow failed";
        serverLog("error", "project", `remove-workflow 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "remove_failed", detail: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/workflow-status",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "workflow-status 开始", {
        projectId: proj.id,
      });
      try {
        const status = await getWorkflowStatus(proj.path);
        serverLog(
          "info",
          "project",
          `workflow-status 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: { applied: status.applied },
          },
        );
        return reply.send(status);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "project", `workflow-status 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "status_failed", detail: msg });
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
