import type { FastifyInstance, FastifyReply } from "fastify";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";

interface ProjectDocFile {
  name: string;
}

interface ProjectDocsListResult {
  docs: ProjectDocFile[];
}

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

async function scanProjectDocs(projectPath: string): Promise<ProjectDocsListResult> {
  const docsDir = resolve(projectPath, "docs");
  try {
    const entries = await readdir(docsDir, { withFileTypes: true });
    const docs = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
      .map((e) => ({ name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { docs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { docs: [] };
    }
    throw err;
  }
}

export async function registerProjectDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/project-docs",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;

      const started = Date.now();
      serverLog("info", "project-docs", "list 开始", { projectId: proj.id });
      try {
        const result = await scanProjectDocs(proj.path);
        serverLog("info", "project-docs", `list 成功 (${Date.now() - started}ms)`, {
          projectId: proj.id,
          meta: { count: result.docs.length },
        });
        return reply.send(result);
      } catch (err) {
        const e = err as Error;
        serverLog("error", "project-docs", `list 失败: ${e.message}`, {
          projectId: proj.id,
          meta: { error: { name: e.name, message: e.message } },
        });
        return reply
          .code(500)
          .send({ error: "project_docs_failed", message: e.message });
      }
    },
  );
}
