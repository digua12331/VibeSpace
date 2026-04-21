import type { FastifyInstance } from "fastify";
import { readFileSync, statSync, writeFileSync } from "node:fs";
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
import { KARPATHY_GUIDELINES } from "../karpathy-guidelines.js";
import { DEV_DOCS_GUIDELINES } from "../dev-docs-guidelines.js";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1),
  applyKarpathyGuidelines: z.boolean().optional(),
  applyDevDocsGuidelines: z.boolean().optional(),
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

function appendKarpathyGuidelines(projectPath: string): boolean {
  return appendToClaudeMd(
    projectPath,
    KARPATHY_GUIDELINES,
    KARPATHY_GUIDELINES.trimEnd(),
  );
}

function appendDevDocsGuidelines(projectPath: string): boolean {
  // Stable anchor so re-applying is a no-op even if user edits surrounding text.
  return appendToClaudeMd(
    projectPath,
    DEV_DOCS_GUIDELINES,
    "# Dev Docs 工作流",
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
    const {
      name,
      path,
      applyKarpathyGuidelines,
      applyDevDocsGuidelines,
    } = parsed.data;

    // Validate path exists & is directory
    try {
      const st = statSync(path);
      if (!st.isDirectory()) {
        return reply.code(400).send({ error: "path_not_directory", path });
      }
    } catch {
      return reply.code(400).send({ error: "path_not_found", path });
    }

    try {
      const proj = createProject({ id: nanoid(12), name, path });
      if (applyKarpathyGuidelines) {
        try {
          appendKarpathyGuidelines(path);
        } catch (err) {
          app.log.warn(
            { err, path },
            "failed to append Karpathy guidelines to CLAUDE.md",
          );
        }
      }
      if (applyDevDocsGuidelines) {
        try {
          appendDevDocsGuidelines(path);
        } catch (err) {
          app.log.warn(
            { err, path },
            "failed to append Dev Docs guidelines to CLAUDE.md",
          );
        }
      }
      return reply.code(201).send(proj);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("UNIQUE") || msg.includes("constraint")) {
        return reply.code(409).send({ error: "path_already_exists", path });
      }
      throw err;
    }
  });

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

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (req, reply) => {
      const { id } = req.params;
      const proj = getProject(id);
      if (!proj) return reply.code(404).send({ error: "not_found" });

      // Kill any live sessions for this project, then mark them stopped.
      const sessions = listSessionsByProject(id);
      for (const s of sessions) {
        if (ptyManager.isAlive(s.id)) {
          ptyManager.kill(s.id);
          endSession(s.id, "stopped", null);
        }
      }
      const ok = dbDeleteProject(id);
      return reply.send({ ok, id });
    },
  );
}
