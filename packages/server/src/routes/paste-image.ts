import type { FastifyInstance, FastifyReply } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getProject } from "../db.js";
import { appendGitignoreEntry } from "./fs-ops.js";

const ALLOWED_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MAX_BYTES = 5 * 1024 * 1024;
const REL_DIR = ".vibespace/pasted-images";

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
 * `2026-04-21T10-30-00-123` — ISO 8601 millis with the colons replaced so the
 * string is a valid Windows filename segment.
 */
function fsFriendlyTimestamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

export async function registerPasteImageRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/paste-image",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;

      // @fastify/multipart exposes req.file() when registered. Narrow via a
      // local cast to keep the type-surface tight.
      const reqAny = req as unknown as {
        file(): Promise<
          | {
              mimetype: string;
              toBuffer(): Promise<Buffer>;
            }
          | undefined
        >;
      };

      let part: Awaited<ReturnType<typeof reqAny.file>> | undefined;
      try {
        part = await reqAny.file();
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        return reply.code(400).send({ error: "invalid_upload", message: msg });
      }

      if (!part) {
        return reply.code(400).send({ error: "no_file" });
      }

      const mime = part.mimetype;
      if (!ALLOWED_MIME.has(mime)) {
        return reply.code(415).send({ error: "unsupported_mime", mime });
      }

      let buf: Buffer;
      try {
        buf = await part.toBuffer();
      } catch (err) {
        // @fastify/multipart throws `RequestFileTooLargeError` when the plugin
        // limit is hit — surface as 413.
        const msg = (err as Error)?.message ?? String(err);
        if (/file too large|FST_REQ_FILE_TOO_LARGE/i.test(msg)) {
          return reply.code(413).send({ error: "too_large", limit: MAX_BYTES });
        }
        return reply.code(400).send({ error: "read_failed", message: msg });
      }

      if (buf.length > MAX_BYTES) {
        return reply.code(413).send({ error: "too_large", limit: MAX_BYTES });
      }

      const ext = MIME_TO_EXT[mime];
      const name = `${fsFriendlyTimestamp()}-${randomBytes(3).toString("hex")}.${ext}`;
      const absDir = join(proj.path, REL_DIR);
      const absPath = join(absDir, name);
      const relPath = `${REL_DIR}/${name}`;

      try {
        await mkdir(absDir, { recursive: true });
        await writeFile(absPath, buf);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        return reply.code(500).send({ error: "write_failed", message: msg });
      }

      // Quietly make sure the image dir is git-ignored. A failure here is
      // non-fatal for the caller — we still have the file on disk.
      try {
        await appendGitignoreEntry(proj.path, ".vibespace/");
      } catch (err) {
        app.log.warn({ err }, "failed to update .gitignore for pasted image");
      }

      return reply.send({
        relPath,
        absPath,
        bytes: buf.length,
        mime,
      });
    },
  );
}
