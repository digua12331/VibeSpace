/**
 * 外部工具集路由 —— 给前端"设置抽屉 → 工具集"tab 提供 gstack 的 status /
 * install / update / uninstall 四个端点。
 *
 * 不挂在 `/api/projects/:id/*` 下：gstack 是机器级的 Claude Code skill 集合，
 * 写到 `~/.claude/skills/gstack`，不属于任何单个项目（auto.md 2026-05-02
 * 技能市场二期"全机器级能力优先挂独立 /api/<feature>/* 路由"经验）。
 */
import type { FastifyInstance } from "fastify";
import {
  getGstackStatus,
  installGstack,
  uninstallGstack,
  updateGstack,
} from "../gstack-installer.js";

export async function registerExternalToolsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ---------- GET /external-tools/gstack/status ----------
  app.get("/api/external-tools/gstack/status", async (_req, reply) => {
    const status = await getGstackStatus();
    return reply.send(status);
  });

  // ---------- POST /external-tools/gstack/install ----------
  app.post("/api/external-tools/gstack/install", async (_req, reply) => {
    const result = await installGstack();
    if (!result.ok) {
      // 412 Precondition Failed 用于"前置条件不满足"（bun/git 不可用、repo 不可达），
      // 真正运行时失败用 500 区分。
      const code =
        result.errorCode === "bun_unavailable" ||
        result.errorCode === "git_unavailable" ||
        result.errorCode === "repo_unreachable"
          ? 412
          : 500;
      return reply.code(code).send(result);
    }
    return reply.send(result);
  });

  // ---------- POST /external-tools/gstack/update ----------
  app.post("/api/external-tools/gstack/update", async (_req, reply) => {
    const result = await updateGstack();
    if (!result.ok) {
      return reply.code(500).send(result);
    }
    return reply.send(result);
  });

  // ---------- DELETE /external-tools/gstack ----------
  app.delete("/api/external-tools/gstack", async (_req, reply) => {
    const result = await uninstallGstack();
    if (!result.ok) {
      return reply.code(500).send(result);
    }
    return reply.send(result);
  });
}
