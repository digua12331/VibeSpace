import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CLI_CATALOG,
  getCliEntry,
  resolveInstallCommand,
  type CliEntry,
} from "../cli-catalog.js";
import { findExecutable } from "../pty-manager.js";
import { installJobs } from "../install-jobs.js";

interface CliStatusItem {
  installed: boolean;
  path: string | null;
}

function detectAll(): Record<string, CliStatusItem> {
  const out: Record<string, CliStatusItem> = {};
  for (const e of CLI_CATALOG) {
    let hit: string | null = null;
    for (const name of e.bin) {
      hit = findExecutable(name);
      if (hit) break;
    }
    out[e.id] = { installed: !!hit, path: hit };
  }
  return out;
}

function detectRequires(): Record<string, boolean> {
  const tools = new Set<string>();
  for (const e of CLI_CATALOG) for (const r of e.requires ?? []) tools.add(r);
  const out: Record<string, boolean> = {};
  for (const t of tools) out[t] = !!findExecutable(t);
  return out;
}

/** Strip optional shell-spawn metadata from the entry before sending to clients. */
function publicEntry(e: CliEntry): Omit<CliEntry, "spawnArgs"> & { installCmd: string | null } {
  return {
    id: e.id,
    label: e.label,
    bin: e.bin,
    install: e.install,
    description: e.description,
    builtin: e.builtin,
    requires: e.requires,
    homepage: e.homepage,
    installCmd: resolveInstallCommand(e),
  };
}

const InstallBody = z.object({ cliId: z.string().min(1) });

// Must stay in sync with the cors origin list in index.ts — SSE bypasses
// @fastify/cors, so this route sets the header itself.
const ALLOWED_ORIGINS = new Set<string>(
  process.env.AIMON_WEB_ORIGIN
    ? process.env.AIMON_WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
    : ["http://127.0.0.1:8788", "http://localhost:8788"],
);

export async function registerCliInstallerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/cli-installer/catalog", async () => {
    return CLI_CATALOG.map(publicEntry);
  });

  app.get("/api/cli-installer/status", async () => {
    return {
      cli: detectAll(),
      requires: detectRequires(),
      platform: process.platform,
    };
  });

  app.post("/api/cli-installer/install", async (req, reply) => {
    const parsed = InstallBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const entry = getCliEntry(parsed.data.cliId);
    if (!entry) return reply.code(404).send({ error: "unknown_cli" });
    const cmd = resolveInstallCommand(entry);
    if (!cmd) {
      return reply.code(400).send({
        error: "no_install_command",
        detail: `no install command for ${entry.id} on ${process.platform}`,
      });
    }
    const job = installJobs.start(entry.id, cmd);
    return reply.code(202).send({ jobId: job.id, cmdline: job.cmdline });
  });

  app.get<{ Params: { id: string } }>(
    "/api/cli-installer/jobs/:id",
    async (req, reply) => {
      const j = installJobs.get(req.params.id);
      if (!j) return reply.code(404).send({ error: "not_found" });
      return j;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/cli-installer/jobs/:id",
    async (req, reply) => {
      const ok = installJobs.cancel(req.params.id);
      if (!ok) return reply.code(404).send({ error: "not_found_or_finished" });
      return reply.code(204).send();
    },
  );

  // SSE log stream. Sends a `snapshot` once, then `log` chunks, then `exit`.
  app.get<{ Params: { id: string } }>(
    "/api/cli-installer/jobs/:id/stream",
    (req, reply) => {
      const id = req.params.id;
      const j = installJobs.get(id);
      if (!j) {
        reply.code(404).send({ error: "not_found" });
        return;
      }
      // We write to reply.raw directly, which bypasses @fastify/cors's onSend
      // hook — so we have to mirror the CORS headers manually here, otherwise
      // EventSource from 127.0.0.1:8788 gets blocked.
      const origin = req.headers.origin;
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        reply.raw.setHeader("access-control-allow-origin", origin);
        reply.raw.setHeader("vary", "Origin");
      }
      reply.raw.setHeader("content-type", "text/event-stream");
      reply.raw.setHeader("cache-control", "no-cache");
      reply.raw.setHeader("connection", "keep-alive");
      reply.raw.setHeader("x-accel-buffering", "no");
      reply.raw.flushHeaders?.();
      reply.raw.write(
        `event: snapshot\ndata: ${JSON.stringify({
          log: j.log,
          state: j.state,
          exitCode: j.exitCode,
        })}\n\n`,
      );

      // If the job already finished before the client connected, close right away.
      if (j.state !== "running") {
        reply.raw.write(
          `event: exit\ndata: ${JSON.stringify({ exitCode: j.exitCode, state: j.state })}\n\n`,
        );
        try { reply.raw.end(); } catch { /* ignore */ }
        return;
      }

      const onLog = (jid: string, chunk: string): void => {
        if (jid !== id) return;
        reply.raw.write(`event: log\ndata: ${JSON.stringify(chunk)}\n\n`);
      };
      const onExit = (jid: string, exitCode: number | null, state: string): void => {
        if (jid !== id) return;
        reply.raw.write(
          `event: exit\ndata: ${JSON.stringify({ exitCode, state })}\n\n`,
        );
        cleanup();
      };
      const cleanup = (): void => {
        installJobs.off("log", onLog);
        installJobs.off("exit", onExit);
        try { reply.raw.end(); } catch { /* ignore */ }
      };
      installJobs.on("log", onLog);
      installJobs.on("exit", onExit);
      req.raw.on("close", cleanup);
    },
  );
}
