/**
 * Project-scoped Claude settings (`<projectPath>/.claude/settings.json`).
 *
 * Mirrors `routes/claude-settings.ts` but operates on the in-repo project
 * settings file instead of `~/.claude/settings.json`. Claude Code's settings
 * hierarchy (Managed > Local > **Project** > User) lets these values override
 * user-global ones on a per-key basis — that's what enables "follow global /
 * force-on / force-off" three-state UI per plugin or skill.
 *
 * Routes:
 *  - GET /api/project-claude-settings?projectId=X
 *  - PUT /api/project-claude-settings   { projectId, skillOverrides?, enabledPlugins? }
 *
 * `enabledPlugins` accepts `null` to mean "delete the entry" (= follow global).
 * `skillOverrides` accepts `'off' | null` matching the global route.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getClaudeSettingsPath,
  patchClaudeSettings,
  readClaudeSettings,
  type ClaudeSettingsPatch,
  type SettingsScope,
} from "../claude-settings.js";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";

const KEY = z.string().min(1).max(200, "key 长度超出 200，疑似异常输入");

const SkillOverrideValue = z.union([z.literal("off"), z.null()]);
const PluginValue = z.union([z.boolean(), z.null()]);

const PatchBody = z
  .object({
    projectId: z.string().min(1).max(200),
    skillOverrides: z.record(KEY, SkillOverrideValue).optional(),
    enabledPlugins: z.record(KEY, PluginValue).optional(),
  })
  .refine(
    (b) => b.skillOverrides != null || b.enabledPlugins != null,
    { message: "skillOverrides 与 enabledPlugins 至少传一个" },
  );

function summarize(s: Record<string, unknown>): {
  skillOverrides: Record<string, "off">;
  enabledPlugins: Record<string, boolean>;
} {
  const out = {
    skillOverrides: {} as Record<string, "off">,
    enabledPlugins: {} as Record<string, boolean>,
  };
  const so = s.skillOverrides;
  if (so && typeof so === "object" && !Array.isArray(so)) {
    for (const [k, v] of Object.entries(so as Record<string, unknown>)) {
      if (v === "off") out.skillOverrides[k] = "off";
    }
  }
  const ep = s.enabledPlugins;
  if (ep && typeof ep === "object" && !Array.isArray(ep)) {
    for (const [k, v] of Object.entries(ep as Record<string, unknown>)) {
      if (typeof v === "boolean") out.enabledPlugins[k] = v;
    }
  }
  return out;
}

function projectScopeFor(projectId: string): SettingsScope | null {
  const proj = getProject(projectId);
  if (!proj) return null;
  return { kind: "project", projectPath: proj.path };
}

export async function registerProjectClaudeSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>(
    "/api/project-claude-settings",
    async (req, reply) => {
      const projectId = (req.query.projectId ?? "").trim();
      if (!projectId) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: "projectId 必填" });
      }
      const scope = projectScopeFor(projectId);
      if (!scope) {
        return reply
          .code(404)
          .send({ error: "project_not_found", detail: projectId });
      }
      const r = readClaudeSettings(scope);
      const projection = summarize(r.settings);
      return reply.send({
        ...projection,
        path: getClaudeSettingsPath(scope),
        exists: r.exists,
        ...(r.parseError ? { parseError: r.parseError } : {}),
      });
    },
  );

  app.put<{ Body: unknown }>(
    "/api/project-claude-settings",
    async (req, reply) => {
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const { projectId, ...rest } = parsed.data;
      const scope = projectScopeFor(projectId);
      if (!scope) {
        return reply
          .code(404)
          .send({ error: "project_not_found", detail: projectId });
      }
      const patch: ClaudeSettingsPatch = {
        ...(rest.skillOverrides ? { skillOverrides: rest.skillOverrides } : {}),
        ...(rest.enabledPlugins ? { enabledPlugins: rest.enabledPlugins } : {}),
      };
      const startedAt = Date.now();
      const counts = {
        skillOverrideKeys: patch.skillOverrides
          ? Object.keys(patch.skillOverrides).length
          : 0,
        pluginKeys: patch.enabledPlugins
          ? Object.keys(patch.enabledPlugins).length
          : 0,
      };
      serverLog("info", "project-claude-settings", "patch 开始", {
        projectId,
        meta: {
          counts,
          skillOverrideSample: patch.skillOverrides
            ? Object.keys(patch.skillOverrides).slice(0, 5)
            : [],
          pluginSample: patch.enabledPlugins
            ? Object.keys(patch.enabledPlugins).slice(0, 5)
            : [],
        },
      });
      try {
        const next = patchClaudeSettings(patch, scope);
        const projection = summarize(next.settings);
        serverLog(
          "info",
          "project-claude-settings",
          `patch 成功 (${Date.now() - startedAt}ms)`,
          {
            projectId,
            meta: { counts, ms: Date.now() - startedAt },
          },
        );
        return reply.send({
          ...projection,
          path: getClaudeSettingsPath(scope),
          exists: true,
        });
      } catch (err) {
        const e = err as Error;
        serverLog(
          "error",
          "project-claude-settings",
          `patch 失败: ${e.message}`,
          {
            projectId,
            meta: {
              ms: Date.now() - startedAt,
              counts,
              error: { name: e.name, message: e.message, stack: e.stack },
            },
          },
        );
        return reply.code(500).send({
          error: "project_claude_settings_write_failed",
          message: e.message,
        });
      }
    },
  );
}
