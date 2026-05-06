import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";
import {
  SKILL_AGENT_TYPES,
  SkillCatalogError,
  addSkill,
  removeSkill,
  scanSkills,
  type SkillAgentType,
} from "../skill-catalog-service.js";

const AgentParam = z.object({
  agentType: z.enum(SKILL_AGENT_TYPES as readonly [string, ...string[]]),
});

const AddBody = z.object({
  srcPath: z.string().min(1).max(2000),
  useSymlink: z.boolean().optional(),
});

const RemoveBody = z.object({
  skillName: z.string().min(1).max(200),
});

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof SkillCatalogError) {
    return reply
      .code(err.httpStatus)
      .send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply
    .code(500)
    .send({ error: "skill_catalog_failed", message: msg });
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

export async function registerSkillCatalogRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ---------- GET scan (project + global combined) ----------
  app.get<{ Params: { id: string; agentType: string } }>(
    "/api/projects/:id/skill-catalog/:agentType",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = AgentParam.safeParse({ agentType: req.params.agentType });
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_agent_type", detail: parsed.error.issues });
      }
      try {
        const result = scanSkills(
          proj.path,
          parsed.data.agentType as SkillAgentType,
        );
        return reply.send(result);
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // ---------- POST add ----------
  app.post<{
    Params: { id: string; agentType: string };
    Body: unknown;
  }>(
    "/api/projects/:id/skill-catalog/:agentType/add",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const agentParsed = AgentParam.safeParse({
        agentType: req.params.agentType,
      });
      if (!agentParsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_agent_type", detail: agentParsed.error.issues });
      }
      const bodyParsed = AddBody.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: bodyParsed.error.issues });
      }
      const agentType = agentParsed.data.agentType as SkillAgentType;
      const { srcPath, useSymlink } = bodyParsed.data;
      const t0 = Date.now();
      serverLog("info", "skill-catalog", "skill-add 开始", {
        projectId: proj.id,
        meta: { agentType, srcPath, useSymlink: !!useSymlink },
      });
      try {
        const r = addSkill({
          projectPath: proj.path,
          agentType,
          srcPath,
          useSymlink,
        });
        serverLog(
          "info",
          "skill-catalog",
          `skill-add 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              agentType,
              srcPath,
              targetPath: r.targetPath,
              mode: r.mode,
              fellBackToCopy: r.fellBackToCopy,
            },
          },
        );
        return reply.send(r);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "skill-catalog", `skill-add 失败: ${msg}`, {
          projectId: proj.id,
          meta: {
            agentType,
            srcPath,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return sendError(reply, err);
      }
    },
  );

  // ---------- POST remove (POST not DELETE — body in DELETE is unreliable) ----------
  app.post<{
    Params: { id: string; agentType: string };
    Body: unknown;
  }>(
    "/api/projects/:id/skill-catalog/:agentType/remove",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const agentParsed = AgentParam.safeParse({
        agentType: req.params.agentType,
      });
      if (!agentParsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_agent_type", detail: agentParsed.error.issues });
      }
      const bodyParsed = RemoveBody.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: bodyParsed.error.issues });
      }
      const agentType = agentParsed.data.agentType as SkillAgentType;
      const { skillName } = bodyParsed.data;
      const t0 = Date.now();
      serverLog("info", "skill-catalog", "skill-remove 开始", {
        projectId: proj.id,
        meta: { agentType, skillName },
      });
      try {
        const r = removeSkill({
          projectPath: proj.path,
          agentType,
          skillName,
        });
        serverLog(
          "info",
          "skill-catalog",
          `skill-remove 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              agentType,
              skillName,
              removedPath: r.removedPath,
              wasSymlink: r.wasSymlink,
            },
          },
        );
        return reply.send(r);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "skill-catalog", `skill-remove 失败: ${msg}`, {
          projectId: proj.id,
          meta: {
            agentType,
            skillName,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return sendError(reply, err);
      }
    },
  );
}
