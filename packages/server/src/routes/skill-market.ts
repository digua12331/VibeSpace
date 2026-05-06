import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { serverLog } from "../log-bus.js";
import {
  SkillMarketError,
  deleteLibrarySkill,
  downloadSkill,
  getLocalLibraryPath,
  scanLocalLibrary,
  searchSkills,
  setLocalLibraryPath,
} from "../skill-market-service.js";

const SearchQuery = z.object({
  q: z.string().max(200).optional().default(""),
  source: z.enum(["github", "skills-sh", "all"]).optional().default("all"),
  page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? 1 : Number(v)))
    .pipe(z.number().int().min(1).max(50)),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? 20 : Number(v)))
    .pipe(z.number().int().min(1).max(50)),
});

const DownloadBody = z.object({
  repoUrl: z.string().min(1).max(200),
  skillName: z.string().min(1).max(200),
});

const SetPathBody = z.object({
  path: z.string().min(1).max(2000),
  migrate: z.boolean().optional(),
});

const DeleteBody = z.object({
  name: z.string().min(1).max(200),
  source: z.enum(["official", "custom"]),
});

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof SkillMarketError) {
    return reply
      .code(err.httpStatus)
      .send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "skill_market_failed", message: msg });
}

export async function registerSkillMarketRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ---------- GET /api/skill-market/search ----------
  app.get("/api/skill-market/search", async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", detail: parsed.error.issues });
    }
    const { q, source, page, limit } = parsed.data;
    const t0 = Date.now();
    serverLog("info", "skill-market", "skill-market-search 开始", {
      meta: { q, source, page, limit },
    });
    try {
      const result = await searchSkills({ q, source, page, limit });
      serverLog(
        "info",
        "skill-market",
        `skill-market-search 成功 (${Date.now() - t0}ms)`,
        {
          meta: {
            q,
            source,
            cached: result.cached,
            githubCount: result.github?.items.length ?? null,
            skillsShCount: result.skillsSh?.items.length ?? null,
            rateLimitRemaining: result.github?.rateLimitRemaining ?? null,
          },
        },
      );
      return reply.send(result);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      serverLog("error", "skill-market", `skill-market-search 失败: ${msg}`, {
        meta: {
          q,
          source,
          error: { name: (err as Error).name, message: msg },
        },
      });
      return sendError(reply, err);
    }
  });

  // ---------- POST /api/skill-market/download ----------
  app.post("/api/skill-market/download", async (req, reply) => {
    const parsed = DownloadBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { repoUrl, skillName } = parsed.data;
    const t0 = Date.now();
    serverLog("info", "skill-market", "skill-market-download 开始", {
      meta: { repoUrl, skillName },
    });
    try {
      const r = await downloadSkill({ repoUrl, skillName });
      serverLog(
        "info",
        "skill-market",
        `skill-market-download 成功 (${Date.now() - t0}ms)`,
        {
          meta: {
            repoUrl,
            skillName,
            path: r.path,
            sizeBytes: r.sizeBytes,
            fileCount: r.fileCount,
          },
        },
      );
      return reply.send(r);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      serverLog("error", "skill-market", `skill-market-download 失败: ${msg}`, {
        meta: {
          repoUrl,
          skillName,
          error: { name: (err as Error).name, message: msg },
        },
      });
      return sendError(reply, err);
    }
  });

  // ---------- GET /api/skill-market/library ----------
  app.get("/api/skill-market/library", async (_req, reply) => {
    try {
      return reply.send(scanLocalLibrary());
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---------- GET /api/skill-market/library/path ----------
  app.get("/api/skill-market/library/path", async (_req, reply) => {
    try {
      return reply.send({ path: getLocalLibraryPath() });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // ---------- POST /api/skill-market/library/delete ----------
  app.post("/api/skill-market/library/delete", async (req, reply) => {
    const parsed = DeleteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { name, source } = parsed.data;
    const t0 = Date.now();
    serverLog("info", "skill-market", "skill-market-library-delete 开始", {
      meta: { name, source },
    });
    try {
      const r = deleteLibrarySkill({ name, source });
      serverLog(
        "info",
        "skill-market",
        `skill-market-library-delete 成功 (${Date.now() - t0}ms)`,
        { meta: { name, source, path: r.path } },
      );
      return reply.send(r);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      serverLog(
        "error",
        "skill-market",
        `skill-market-library-delete 失败: ${msg}`,
        {
          meta: {
            name,
            source,
            error: { name: (err as Error).name, message: msg },
          },
        },
      );
      return sendError(reply, err);
    }
  });

  // ---------- POST /api/skill-market/library/path ----------
  app.post("/api/skill-market/library/path", async (req, reply) => {
    const parsed = SetPathBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { path, migrate } = parsed.data;
    const t0 = Date.now();
    serverLog("info", "skill-market", "skill-market-set-library-path 开始", {
      meta: { path, migrate: !!migrate },
    });
    try {
      const r = setLocalLibraryPath(path, !!migrate);
      serverLog(
        "info",
        "skill-market",
        `skill-market-set-library-path 成功 (${Date.now() - t0}ms)`,
        { meta: { path: r.path, migrated: r.migrated } },
      );
      return reply.send(r);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      serverLog(
        "error",
        "skill-market",
        `skill-market-set-library-path 失败: ${msg}`,
        {
          meta: {
            path,
            error: { name: (err as Error).name, message: msg },
          },
        },
      );
      return sendError(reply, err);
    }
  });
}
