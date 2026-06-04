import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { serverLog } from "../log-bus.js";
import { getProject } from "../db.js";
import { isGitRepo } from "../git-service.js";
import {
  LocalAiError,
  listModels,
  listProviders,
  runCommitMessage,
} from "../local-ai-service.js";

const ProviderEnum = z.enum(["ollama", "lmstudio"]);
const ProviderQuery = z.object({ provider: ProviderEnum });
const CommitMessageBody = z.object({
  projectId: z.string().min(1),
  provider: ProviderEnum,
  model: z.string().min(1).max(200),
});

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof LocalAiError) {
    return reply.code(err.http).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(502).send({ error: "local_ai_failed", message: msg });
}

export async function registerLocalAiRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /api/local-ai/providers ----------
  // Reachability probe (health-check-ish) → no operation log pair.
  app.get("/api/local-ai/providers", async (_req, reply) => {
    try {
      return reply.send(await listProviders());
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---------- GET /api/local-ai/models?provider= ----------
  app.get("/api/local-ai/models", async (req, reply) => {
    const parsed = ProviderQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }
    try {
      return reply.send({ models: await listModels(parsed.data.provider) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---------- POST /api/local-ai/commit-message ----------
  // User-triggered action → serverLog start/end pair (scope=ai). Generates a
  // one-line commit message from the working diff; never commits.
  app.post("/api/local-ai/commit-message", async (req, reply) => {
    const parsed = CommitMessageBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { projectId, provider, model } = parsed.data;
    const proj = getProject(projectId);
    if (!proj) {
      return reply.code(404).send({ error: "project_not_found" });
    }

    const t0 = Date.now();
    serverLog("info", "ai", "commit-message 开始", {
      projectId,
      meta: { provider, model },
    });
    try {
      if (!(await isGitRepo(proj.path))) {
        throw new LocalAiError("not_a_git_repo", "该项目不是 Git 仓库", 400);
      }
      const result = await runCommitMessage(proj.path, provider, model);
      serverLog("info", "ai", `commit-message 成功 (${Date.now() - t0}ms)`, {
        projectId,
        meta: {
          provider,
          model,
          length: result.message.length,
          truncated: result.truncated,
        },
      });
      return reply.send(result);
    } catch (err) {
      const e = err as Error;
      serverLog("error", "ai", `commit-message 失败: ${e?.message ?? String(err)}`, {
        projectId,
        meta: {
          provider,
          model,
          error: { name: e?.name, message: e?.message },
        },
      });
      return sendError(reply, err);
    }
  });
}
