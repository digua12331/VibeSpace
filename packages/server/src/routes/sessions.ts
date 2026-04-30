import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  BUILTIN_SHELL_AGENTS,
  createSession,
  endSession,
  findSessionBoundToTask,
  getProject,
  getSession,
  getSessionScope,
  listSessions,
  listSessionsByProject,
  setSessionScope,
  setSessionTask,
  setSessionWorktree,
  updateSessionPid,
  type Agent,
  type Session,
  type SessionIsolation,
  type SessionScope,
  type SessionStatus,
} from "../db.js";
import { ptyManager } from "../pty-manager.js";
import { statusManager } from "../status.js";
import { getCliEntry } from "../cli-catalog.js";
import {
  addWorktree,
  isGitRepo,
  removeWorktree,
} from "../git-service.js";
import {
  buildWorktreeBranch,
  getWorktreePath,
} from "../worktree-paths.js";
import { serverLog } from "../log-bus.js";
import { injectMcpForAgent } from "../mcp-bridge.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { buildRuntimePrompt, pickSkillsForTask } from "../skills-service.js";

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

const TaskNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !/[\\/:*?"<>|]/.test(s), {
    message: "task name contains forbidden chars",
  });

const CreateSessionSchema = z.object({
  projectId: z.string().min(1),
  agent: z
    .string()
    .min(1)
    .refine((id) => BUILTIN.has(id) || !!getCliEntry(id), {
      message: "unknown agent",
    }),
  scope: ScopeSchema.optional(),
  isolation: z.enum(["shared", "worktree"]).optional().default("shared"),
  task: TaskNameSchema.optional(),
});

const PatchTaskSchema = z.object({
  task: TaskNameSchema.nullable(),
  force: z.boolean().optional(),
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
  isolation: SessionIsolation;
  worktreeBranch?: string;
  worktreePath?: string;
  task?: string;
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
    isolation: s.isolation,
  };
  if (scope) base.scope = scope;
  if (s.worktreeBranch) base.worktreeBranch = s.worktreeBranch;
  if (s.worktreePath) base.worktreePath = s.worktreePath;
  if (s.task) base.task = s.task;
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
    return startSession(
      parsed.data.projectId,
      parsed.data.agent,
      reply,
      parsed.data.scope,
      parsed.data.isolation,
      parsed.data.task ?? null,
    );
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id/task",
    async (req, reply) => {
      const parsed = PatchTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const { id } = req.params;
      const s = getSession(id);
      if (!s) return reply.code(404).send({ error: "not_found" });
      const { task, force } = parsed.data;
      const previousTask = s.task;

      // Preempt detection: when binding to a non-null task that is already
      // bound to a *different* alive session in the same project, return 409
      // unless the caller explicitly passed force:true. UI flow: 409 → confirm
      // → re-PATCH with force:true.
      if (task !== null) {
        const occupant = findSessionBoundToTask(s.projectId, task);
        if (occupant && occupant.id !== id) {
          if (!force) {
            return reply.code(409).send({
              error: "task_already_bound",
              detail: `task "${task}" is already bound to session ${occupant.id}`,
              occupantSessionId: occupant.id,
              occupantAgent: occupant.agent,
            });
          }
          // Forced takeover: clear the old binding first.
          setSessionTask(occupant.id, null);
          serverLog("info", "session", "unbind-task (preempted)", {
            projectId: s.projectId,
            sessionId: occupant.id,
            meta: { task, byOther: id },
          });
        }
      }

      setSessionTask(id, task);
      const action = task === null ? "unbind-task" : "bind-task";
      serverLog("info", "session", `${action} 成功`, {
        projectId: s.projectId,
        sessionId: id,
        meta: { task, previousTask },
      });

      const updated = getSession(id);
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return reply.send(serialize(decorateStatus(updated), getSessionScope(id) ?? undefined));
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { gc?: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const { id } = req.params;
      const s = getSession(id);
      if (!s) return reply.code(404).send({ error: "not_found" });
      if (ptyManager.has(id)) {
        ptyManager.kill(id);
      }
      endSession(id, "stopped", null);

      // Optional worktree GC. Default off: keep the worktree so the user can
      // still inspect / merge / cherry-pick from it after closing the session.
      const gc = req.query.gc === "true" || req.query.gc === "1";
      if (gc && s.isolation === "worktree" && s.worktreePath) {
        const proj = getProject(s.projectId);
        if (proj) {
          const t0 = Date.now();
          serverLog("info", "git", "worktree-remove 开始", {
            projectId: s.projectId,
            sessionId: id,
            meta: { worktreePath: s.worktreePath },
          });
          try {
            await removeWorktree(proj.path, s.worktreePath, { force: true });
            // Clear the DB pointer so project-delete's bulk GC doesn't try to
            // remove this path again (which would just produce a warn log).
            setSessionWorktree(id, null, null);
            serverLog(
              "info",
              "git",
              `worktree-remove 成功 (${Date.now() - t0}ms)`,
              {
                projectId: s.projectId,
                sessionId: id,
                meta: { worktreePath: s.worktreePath },
              },
            );
          } catch (err) {
            const msg = (err as Error).message || "worktree remove failed";
            serverLog("error", "git", `worktree-remove 失败: ${msg}`, {
              projectId: s.projectId,
              sessionId: id,
              meta: {
                worktreePath: s.worktreePath,
                error: { name: (err as Error).name, message: msg },
              },
            });
            // Don't fail DELETE — the session row is already ended; a
            // residual worktree directory is recoverable manually.
          }
        }
      }

      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/restart",
    async (req, reply) => {
      const { id } = req.params;
      const old = getSession(id);
      if (!old) return reply.code(404).send({ error: "not_found" });
      // Restart for isolated sessions would need to either reuse the existing
      // worktree (path keyed by old session id, but the new session gets a
      // fresh nanoid) or build a new one and lose dirty changes. v1 punts:
      // tell the user to close and start a new isolated session manually.
      if (old.isolation === "worktree") {
        return reply.code(400).send({
          error: "restart_not_supported",
          detail:
            "isolated session cannot be restarted; close and start a new one",
        });
      }
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
  isolation: SessionIsolation = "shared",
  task: string | null = null,
): Promise<unknown> {
  const proj = getProject(projectId);
  if (!proj) return reply.code(404).send({ error: "project_not_found" });

  // Worktree isolation requires the project root to actually be a git repo.
  // Front-end greys out the checkbox, but bounce here too as a safety net.
  if (isolation === "worktree") {
    const ok = await isGitRepo(proj.path);
    if (!ok) {
      return reply.code(400).send({
        error: "not_a_git_repo",
        detail: "worktree isolation requires a git repository",
      });
    }
  }

  const sessionId = nanoid(16);
  const created = createSession({
    id: sessionId,
    projectId,
    agent,
    status: "starting",
    pid: null,
    isolation,
    task,
  });
  statusManager.onSpawn(sessionId);
  if (task) {
    serverLog("info", "session", "bind-task 成功", {
      projectId,
      sessionId,
      meta: { task, previousTask: null, atSpawn: true },
    });
  }

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

  // Decide spawn cwd. For 'worktree' isolation, create the worktree first so
  // PTY spawn finds an existing directory.
  let cwd = proj.path;
  let worktreePath: string | null = null;
  let worktreeBranch: string | null = null;
  if (isolation === "worktree") {
    worktreePath = getWorktreePath(projectId, sessionId);
    worktreeBranch = buildWorktreeBranch(sessionId);
    const t0 = Date.now();
    serverLog("info", "git", "worktree-add 开始", {
      projectId,
      sessionId,
      meta: { worktreePath, worktreeBranch },
    });
    try {
      await addWorktree(proj.path, worktreePath, worktreeBranch, "HEAD");
    } catch (err) {
      const msg = (err as Error).message || "worktree add failed";
      serverLog("error", "git", `worktree-add 失败: ${msg}`, {
        projectId,
        sessionId,
        meta: {
          worktreePath,
          worktreeBranch,
          error: { name: (err as Error).name, message: msg },
        },
      });
      endSession(sessionId, "crashed", null);
      return reply
        .code(500)
        .send({ error: "worktree_add_failed", detail: msg });
    }
    serverLog("info", "git", `worktree-add 成功 (${Date.now() - t0}ms)`, {
      projectId,
      sessionId,
      meta: { worktreePath, worktreeBranch },
    });
    setSessionWorktree(sessionId, worktreePath, worktreeBranch);
    cwd = worktreePath;
  }

  // Skills: if the session is bound to a task, see if any project skill
  // wants to be activated for this task name. We write the joined prompt to
  // a runtime file and expose its path via env. Whether the agent reads it
  // is intentionally up to user-side configuration (CLAUDE.md guidance).
  const spawnEnv: Record<string, string> = {};
  if (task) {
    try {
      const matched = await pickSkillsForTask(proj.path, task);
      if (matched.length > 0) {
        const runtimeDir = pathJoin(proj.path, ".aimon", "runtime");
        await mkdir(runtimeDir, { recursive: true });
        const runtimePath = pathJoin(runtimeDir, `${sessionId}-prompt.md`);
        await writeFile(runtimePath, buildRuntimePrompt(matched), "utf8");
        spawnEnv.AIMON_SESSION_PROMPT_PATH = runtimePath;
        serverLog("info", "skills", "injected", {
          projectId,
          sessionId,
          meta: {
            taskName: task,
            skills: matched.map((s) => s.name),
            runtimePath,
          },
        });
      }
    } catch (err) {
      // Skill injection is best-effort. A failure must not block the spawn.
      serverLog(
        "warn",
        "skills",
        `inject failed (non-fatal): ${(err as Error).message}`,
        {
          projectId,
          sessionId,
          meta: { taskName: task },
        },
      );
    }
  }

  // browser-use MCP bridge: write/merge the right config file per agent so
  // that claude / codex sessions see the `mcp__browser-use__*` tools the moment
  // they boot. injectMcpForAgent is best-effort and never throws — a failure
  // here only logs at error level and never blocks the spawn. The MCP config
  // for worktree-isolated sessions is still written to the project root, since
  // claude code searches upwards from cwd.
  await injectMcpForAgent(agent, proj.path, sessionId, projectId);

  let pid: number;
  try {
    const r = ptyManager.spawn({ sessionId, agent, cwd, env: spawnEnv });
    pid = r.pid;
  } catch (err) {
    const msg = (err as Error).message || "spawn failed";
    // PTY failed but worktree (if any) stays — user can DELETE?gc=true to clean.
    endSession(sessionId, "crashed", null);
    return reply.code(500).send({ error: "spawn_failed", detail: msg });
  }
  updateSessionPid(sessionId, pid);

  return reply.code(201).send(
    serialize(
      {
        ...created,
        pid,
        status: "starting" as SessionStatus,
        worktreePath,
        worktreeBranch,
      },
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
