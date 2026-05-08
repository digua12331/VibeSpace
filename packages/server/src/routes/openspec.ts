/**
 * OpenSpec 工作流的 changes CRUD 路由 —— 对应项目 `openspec/changes/<name>/`
 * 下的 proposal.md / design.md / tasks.md 三件套读写。仿照 `routes/docs.ts`
 * 的形态：以项目 id 反查路径（不让前端直接传项目路径，详 auto.md 2026-05-02
 * 技能管理面板的安全约定）。
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolve } from "node:path";
import { z } from "zod";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";
import {
  archiveOpenSpecChange,
  createOpenSpecChange,
  listOpenSpecChanges,
  readOpenSpecChangeFile,
  writeOpenSpecChangeFile,
  type OpenSpecChangeFile,
} from "../openspec-template-service.js";

const FileQuery = z.object({
  kind: z.enum(["proposal", "design", "tasks"]),
});

/** change 名校验：与 TaskNameSchema 同口径（中文友好；禁路径穿越字符）。 */
const ChangeNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !/[\\/:*?"<>|]/.test(s), {
    message: "change name contains forbidden chars",
  });

const CreateBody = z.object({
  name: ChangeNameSchema,
});

const WriteBody = z.object({
  content: z.string(),
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

/**
 * 防路径穿越守卫：name 经 decodeURIComponent + path.resolve 后必须仍在
 * `<projectPath>/openspec/changes/` 下；否则返回 400 阻断。auto.md 2026-05-02
 * 技能管理面板那条经验。
 */
function ensureChangePathSafe(
  projectPath: string,
  name: string,
  reply: FastifyReply,
): boolean {
  const root = resolve(projectPath, "openspec", "changes");
  const target = resolve(root, name);
  if (!target.startsWith(root)) {
    reply.code(400).send({ error: "invalid_change_name" });
    return false;
  }
  return true;
}

export async function registerOpenspecRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ---------- GET /openspec/changes — list ----------
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/openspec/changes",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        const changes = await listOpenSpecChanges(proj.path);
        return reply.send({ changes });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "openspec", `list-changes 失败: ${msg}`, {
          projectId: proj.id,
        });
        return reply
          .code(500)
          .send({ error: "openspec_list_failed", message: msg });
      }
    },
  );

  // ---------- GET /openspec/changes/:name/file?kind=... ----------
  app.get<{
    Params: { id: string; name: string };
    Querystring: unknown;
  }>(
    "/api/projects/:id/openspec/changes/:name/file",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = FileQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: parsed.error.issues });
      }
      const name = decodeURIComponent(req.params.name);
      const nameOk = ChangeNameSchema.safeParse(name);
      if (!nameOk.success) {
        return reply
          .code(400)
          .send({ error: "invalid_change_name", detail: nameOk.error.issues });
      }
      if (!ensureChangePathSafe(proj.path, name, reply)) return;
      try {
        const content = await readOpenSpecChangeFile(
          proj.path,
          name,
          parsed.data.kind as OpenSpecChangeFile,
        );
        if (content === null) {
          return reply.code(404).send({ error: "file_not_found" });
        }
        return reply.send({ content, name, kind: parsed.data.kind });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "openspec", `read-file 失败: ${msg}`, {
          projectId: proj.id,
          meta: { name, kind: parsed.data.kind },
        });
        return reply
          .code(500)
          .send({ error: "openspec_read_failed", message: msg });
      }
    },
  );

  // ---------- PUT /openspec/changes/:name/file?kind=... ----------
  app.put<{
    Params: { id: string; name: string };
    Querystring: unknown;
    Body: unknown;
  }>(
    "/api/projects/:id/openspec/changes/:name/file",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const queryParsed = FileQuery.safeParse(req.query);
      if (!queryParsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: queryParsed.error.issues });
      }
      const bodyParsed = WriteBody.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: bodyParsed.error.issues });
      }
      const name = decodeURIComponent(req.params.name);
      const nameOk = ChangeNameSchema.safeParse(name);
      if (!nameOk.success) {
        return reply
          .code(400)
          .send({ error: "invalid_change_name", detail: nameOk.error.issues });
      }
      if (!ensureChangePathSafe(proj.path, name, reply)) return;
      const t0 = Date.now();
      serverLog("info", "openspec", "write-file 开始", {
        projectId: proj.id,
        meta: { name, kind: queryParsed.data.kind },
      });
      try {
        await writeOpenSpecChangeFile(
          proj.path,
          name,
          queryParsed.data.kind as OpenSpecChangeFile,
          bodyParsed.data.content,
        );
        serverLog(
          "info",
          "openspec",
          `write-file 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              name,
              kind: queryParsed.data.kind,
              bytes: bodyParsed.data.content.length,
            },
          },
        );
        return reply.send({ ok: true });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        const code = msg === "change_not_found" ? 404 : 500;
        serverLog(
          "error",
          "openspec",
          `write-file 失败 (${Date.now() - t0}ms): ${msg}`,
          {
            projectId: proj.id,
            meta: { name, kind: queryParsed.data.kind },
          },
        );
        return reply
          .code(code)
          .send({
            error: code === 404 ? "change_not_found" : "openspec_write_failed",
            message: msg,
          });
      }
    },
  );

  // ---------- POST /openspec/changes — create new change ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/openspec/changes",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const name = parsed.data.name;
      if (!ensureChangePathSafe(proj.path, name, reply)) return;
      const t0 = Date.now();
      serverLog("info", "openspec", "create-change 开始", {
        projectId: proj.id,
        meta: { name },
      });
      try {
        await createOpenSpecChange(proj.path, name);
        serverLog(
          "info",
          "openspec",
          `create-change 成功 (${Date.now() - t0}ms)`,
          { projectId: proj.id, meta: { name } },
        );
        return reply.code(201).send({ ok: true, name });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (msg === "change_exists") {
          serverLog(
            "error",
            "openspec",
            `create-change 失败 (${Date.now() - t0}ms): 同名 change 已存在 ${name}`,
            { projectId: proj.id, meta: { name } },
          );
          return reply.code(409).send({ error: "change_exists", message: msg });
        }
        serverLog(
          "error",
          "openspec",
          `create-change 失败 (${Date.now() - t0}ms): ${msg}`,
          { projectId: proj.id, meta: { name } },
        );
        return reply
          .code(500)
          .send({ error: "openspec_create_failed", message: msg });
      }
    },
  );

  // ---------- POST /openspec/changes/:name/archive ----------
  app.post<{ Params: { id: string; name: string } }>(
    "/api/projects/:id/openspec/changes/:name/archive",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const name = decodeURIComponent(req.params.name);
      const nameOk = ChangeNameSchema.safeParse(name);
      if (!nameOk.success) {
        return reply
          .code(400)
          .send({ error: "invalid_change_name", detail: nameOk.error.issues });
      }
      if (!ensureChangePathSafe(proj.path, name, reply)) return;
      const t0 = Date.now();
      serverLog("info", "openspec", "archive-change 开始", {
        projectId: proj.id,
        meta: { name },
      });
      try {
        const out = await archiveOpenSpecChange(proj.path, name);
        serverLog(
          "info",
          "openspec",
          `archive-change 成功 (${Date.now() - t0}ms)`,
          { projectId: proj.id, meta: { name, archivedTo: out.archivedTo } },
        );
        return reply.send(out);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        const code = msg === "change_not_found" ? 404 : 500;
        serverLog(
          "error",
          "openspec",
          `archive-change 失败 (${Date.now() - t0}ms): ${msg}`,
          { projectId: proj.id, meta: { name } },
        );
        return reply
          .code(code)
          .send({
            error: code === 404 ? "change_not_found" : "openspec_archive_failed",
            message: msg,
          });
      }
    },
  );
}
