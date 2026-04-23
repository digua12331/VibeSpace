import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  BUILTIN_SHELL_AGENTS,
  createSession,
  endSession,
  getProject,
  getSession,
  getSessionScope,
  listSessions,
  listSessionsByProject,
  setSessionScope,
  updateSessionPid,
  type Agent,
  type Session,
  type SessionScope,
  type SessionStatus,
} from "../db.js";
import { ptyManager } from "../pty-manager.js";
import { statusManager } from "../status.js";
import { getCliEntry } from "../cli-catalog.js";

const BUILTIN = new Set<string>(BUILTIN_SHELL_AGENTS);

const GlobListSchema = z
  .array(z.string())
  .max(200)
  .default([])
  .transform((arr) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      const s = raw.trim();
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  });

const ScopeSchema = z
  .object({
    enabled: z.boolean(),
    readwrite: GlobListSchema,
    readonly: GlobListSchema,
  })
  .superRefine((val, ctx) => {
    const bad = (list: string[], field: string) => {
      for (const g of list) {
        if (g.startsWith("/") || /^[A-Za-z]:[\\/]/.test(g) || g.includes("..")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `invalid glob in ${field}: ${g}`,
            path: [field],
          });
          return;
        }
      }
    };
    bad(val.readwrite, "readwrite");
    bad(val.readonly, "readonly");
  });

type ScopeInput = z.infer<typeof ScopeSchema>;

const CreateSessionSchema = z.object({
  projectId: z.string().min(1),
  agent: z
    .string()
    .min(1)
    .refine((id) => BUILTIN.has(id) || !!getCliEntry(id), {
      message: "unknown agent",
    }),
  scope: ScopeSchema.optional(),
});

const ListQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
});

function decorateStatus(s: Session): Session {
  const live = statusManager.get(s.id);
  return live ? { ...s, status: live as SessionStatus } : s;
}

/** Wire shape: snake_case so the web client (and POST response) match. */
interface WireSession {
  id: string;
  projectId: string;
  agent: Agent;
  status: SessionStatus;
  pid: number | null;
  started_at: number;
  ended_at: number | null;
  exit_code: number | null;
  scope?: SessionScope;
}
function serialize(s: Session, scope?: SessionScope): WireSession {
  const base: WireSession = {
    id: s.id,
    projectId: s.projectId,
    agent: s.agent,
    status: s.status,
    pid: s.pid,
    started_at: s.startedAt,
    ended_at: s.endedAt,
    exit_code: s.exitCode,
  };
  if (scope) base.scope = scope;
  return base;
}

function attachScope(s: Session): WireSession {
  const scope = getSessionScope(s.id);
  return serialize(s, scope ?? undefined);
}

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/sessions", async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
    }
    const { projectId } = parsed.data;
    const rows = projectId ? listSessionsByProject(projectId) : listSessions();
    return rows.map(decorateStatus).map(attachScope);
  });

  app.post("/api/sessions", async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    return startSession(parsed.data.projectId, parsed.data.agent, reply, parsed.data.scope);
  });

  app.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const { id } = req.params;
      const s = getSession(id);
      if (!s) return reply.code(404).send({ error: "not_found" });
      if (ptyManager.has(id)) {
        ptyManager.kill(id);
      }
      endSession(id, "stopped", null);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/restart",
    async (req, reply) => {
      const { id } = req.params;
      const old = getSession(id);
      if (!old) return reply.code(404).send({ error: "not_found" });
      if (ptyManager.has(id)) {
        ptyManager.kill(id);
        endSession(id, "stopped", null);
      }
      return startSession(old.projectId, old.agent, reply);
    },
  );
}

async function startSession(
  projectId: string,
  agent: Agent,
  reply: import("fastify").FastifyReply,
  scope?: ScopeInput,
): Promise<unknown> {
  const proj = getProject(projectId);
  if (!proj) return reply.code(404).send({ error: "project_not_found" });

  const sessionId = nanoid(16);
  const created = createSession({
    id: sessionId,
    projectId,
    agent,
    status: "starting",
    pid: null,
  });
  statusManager.onSpawn(sessionId);

  // Persist scope before spawn so the hook can enforce from the first tool use.
  if (scope) {
    try {
      setSessionScope({
        sessionId,
        enabled: scope.enabled,
        readwrite: scope.readwrite,
        readonly: scope.readonly,
      });
    } catch {
      /* non-fatal: session runs unrestricted */
    }
  }

  let pid: number;
  try {
    const r = ptyManager.spawn({ sessionId, agent, cwd: proj.path });
    pid = r.pid;
  } catch (err) {
    const msg = (err as Error).message || "spawn failed";
    endSession(sessionId, "crashed", null);
    return reply.code(500).send({ error: "spawn_failed", detail: msg });
  }
  updateSessionPid(sessionId, pid);

  return reply.code(201).send(
    serialize(
      { ...created, pid, status: "starting" as SessionStatus },
      scope
        ? {
            enabled: scope.enabled,
            readwrite: scope.readwrite,
            readonly: scope.readonly,
          }
        : undefined,
    ),
  );
}
