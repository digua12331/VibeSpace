import type { FastifyInstance } from "fastify";
import { createReadStream, statSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { getProject } from "../db.js";
import { GitServiceError, safeResolve } from "../git-service.js";

// 50 MB — anything bigger gets rejected so we don't accidentally stream a
// random multi-GB file to the browser.
const MAX_BYTES = 50 * 1024 * 1024;

const RawQuery = z.object({
  path: z.string().min(1).max(4096),
});

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};

function mimeFor(p: string): string {
  return EXT_MIME[extname(p).toLowerCase()] ?? "application/octet-stream";
}

export async function registerRawFileRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/raw",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });

      const parsed = RawQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: parsed.error.issues });
      }

      let abs: string;
      try {
        abs = safeResolve(proj.path, parsed.data.path);
      } catch (err) {
        if (err instanceof GitServiceError) {
          return reply
            .code(err.httpStatus)
            .send({ error: err.code, message: err.message });
        }
        throw err;
      }

      if (!existsSync(abs)) {
        return reply.code(404).send({ error: "path_not_found" });
      }
      const st = statSync(abs);
      if (!st.isFile()) {
        return reply.code(400).send({ error: "not_a_file" });
      }
      if (st.size > MAX_BYTES) {
        return reply
          .code(413)
          .send({ error: "too_large", limit: MAX_BYTES, size: st.size });
      }

      reply
        .header("Content-Type", mimeFor(abs))
        .header("Content-Length", String(st.size))
        .header("Cache-Control", "no-cache");
      return reply.send(createReadStream(abs));
    },
  );
}
