import type { FastifyInstance, FastifyReply } from "fastify";
import { getProject } from "../db.js";
import {
  MemoryServiceError,
  readMemory,
  rollbackLessons,
  type RollbackSelection,
} from "../memory-service.js";

interface RollbackBody {
  items?: Array<{ kind?: string; line?: number }>;
}

function sendMemoryError(reply: FastifyReply, err: unknown) {
  if (err instanceof MemoryServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "memory_failed", message: msg });
}

function parseSelections(raw: RollbackBody["items"]): RollbackSelection[] {
  if (!Array.isArray(raw)) {
    throw new MemoryServiceError("bad_request", "items 必须是数组");
  }
  const out: RollbackSelection[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") {
      throw new MemoryServiceError("bad_request", "items 条目必须是对象");
    }
    const kind = it.kind;
    const line = it.line;
    if (kind !== "auto" && kind !== "manual") {
      throw new MemoryServiceError("bad_request", `kind 只能是 auto|manual，收到：${String(kind)}`);
    }
    if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
      throw new MemoryServiceError("bad_request", `line 必须是正整数，收到：${String(line)}`);
    }
    out.push({ kind, line });
  }
  return out;
}

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/memory",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      try {
        const payload = await readMemory(proj.path);
        return reply.send(payload);
      } catch (err) {
        return sendMemoryError(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: RollbackBody }>(
    "/api/projects/:id/memory/rollback",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      try {
        const selections = parseSelections(req.body?.items);
        await rollbackLessons(proj.path, selections);
        const payload = await readMemory(proj.path);
        return reply.send(payload);
      } catch (err) {
        return sendMemoryError(reply, err);
      }
    },
  );
}
