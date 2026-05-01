import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";
import {
  GitServiceError,
  checkoutBranch,
  createBranch,
  createCommit,
  createStash,
  deleteBranch,
  discardPaths,
  fetchAll,
  getChanges,
  getCommit,
  getDiff,
  getGraph,
  isGitRepo,
  listBranches,
  listCommits,
  listProjectFiles,
  listStashes,
  mergeBranch,
  popStash,
  pullCurrent,
  pushCurrent,
  readFileAtRef,
  resetSoftLastCommit,
  stagePaths,
  unstagePaths,
} from "../git-service.js";

const RefParam = z
  .string()
  .min(1)
  .max(64)
  .regex(/^(HEAD|WORKTREE|INDEX|[0-9a-fA-F]{7,40})$/);

const FileQuery = z.object({
  path: z.string().min(1).max(4096),
  ref: RefParam.optional(),
});

const DiffQuery = z.object({
  path: z.string().min(1).max(4096),
  from: RefParam.optional(),
  to: RefParam.optional(),
});

const CommitsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  branch: z.string().min(1).max(256).optional(),
});

const GraphQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  all: z.coerce.boolean().optional(),
});

const FilesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50000).optional(),
});

const PathArray = z.array(z.string().min(1).max(4096)).min(1).max(500);
const StageBody = z.object({ paths: PathArray });
const DiscardBody = z.object({
  tracked: z.array(z.string().min(1).max(4096)).max(500).optional(),
  untracked: z.array(z.string().min(1).max(4096)).max(500).optional(),
});
const CommitBody = z.object({
  message: z.string().min(1).max(10000),
  amend: z.boolean().optional(),
  allowEmpty: z.boolean().optional(),
});

// Branch names: subset of git's allowed chars + length cap.
const BranchName = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((v) => !v.includes(".."), { message: "branch name contains '..'" });

const BranchBody = z.object({ branch: BranchName });
const BranchCreateBody = z.object({
  branch: BranchName,
  checkout: z.boolean().optional(),
});
const BranchDeleteBody = z.object({
  branch: BranchName,
  force: z.boolean().optional(),
});
const StashCreateBody = z.object({
  message: z.string().max(200).optional(),
});

function sendGitError(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof GitServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "git_failed", message: msg });
}

async function loadProjectOr404(
  reply: import("fastify").FastifyReply,
  id: string,
): Promise<{ id: string; path: string } | null> {
  const proj = getProject(id);
  if (!proj) {
    reply.code(404).send({ error: "project_not_found" });
    return null;
  }
  return { id: proj.id, path: proj.path };
}

export async function registerGitRoutes(app: FastifyInstance): Promise<void> {
  // ---------- /changes ----------
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/changes",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        if (!(await isGitRepo(proj.path))) return reply.send({ enabled: false });
        return reply.send(await getChanges(proj.path));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /commits ----------
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/commits",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = CommitsQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) return reply.send([]);
        const rows = await listCommits(proj.path, parsed.data);
        return reply.send(rows);
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /commits/:sha ----------
  app.get<{ Params: { id: string; sha: string } }>(
    "/api/projects/:id/commits/:sha",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const sha = req.params.sha;
      if (!RefParam.safeParse(sha).success) {
        return reply.code(400).send({ error: "invalid_ref" });
      }
      try {
        if (!(await isGitRepo(proj.path))) {
          return reply.code(400).send({ error: "not_a_git_repo" });
        }
        return reply.send(await getCommit(proj.path, sha));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /file ----------
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/file",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = FileQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        if (parsed.data.ref && parsed.data.ref !== "WORKTREE") {
          if (!(await isGitRepo(proj.path))) {
            return reply.code(400).send({ error: "not_a_git_repo" });
          }
        }
        return reply.send(await readFileAtRef(proj.path, parsed.data));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /branches ----------
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/branches",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        if (!(await isGitRepo(proj.path))) return reply.send([]);
        return reply.send(await listBranches(proj.path));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /files ----------
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/files",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = FilesQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        return reply.send(await listProjectFiles(proj.path, parsed.data));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /graph ----------
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/graph",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = GraphQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) return reply.send([]);
        return reply.send(await getGraph(proj.path, parsed.data));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /stage ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/stage",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = StageBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) {
          return reply.code(400).send({ error: "not_a_git_repo" });
        }
        return reply.send(await stagePaths(proj.path, parsed.data.paths));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /unstage ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/unstage",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = StageBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) {
          return reply.code(400).send({ error: "not_a_git_repo" });
        }
        return reply.send(await unstagePaths(proj.path, parsed.data.paths));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /discard ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/discard",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = DiscardBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) {
          return reply.code(400).send({ error: "not_a_git_repo" });
        }
        return reply.send(
          await discardPaths(proj.path, {
            tracked: parsed.data.tracked ?? [],
            untracked: parsed.data.untracked ?? [],
          }),
        );
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /commit ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/commit",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = CommitBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) {
          return reply.code(400).send({ error: "not_a_git_repo" });
        }
        return reply.send(await createCommit(proj.path, parsed.data));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /diff ----------
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/diff",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = DiffQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        if (!(await isGitRepo(proj.path))) {
          return reply.code(400).send({ error: "not_a_git_repo" });
        }
        return reply.send(await getDiff(proj.path, parsed.data));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ===== mutation helper: wrap fn in serverLog start/end pair =====
  async function runLogged<T>(
    reply: import("fastify").FastifyReply,
    projectId: string,
    action: string,
    metaIn: Record<string, unknown> | undefined,
    fn: () => Promise<T>,
  ): Promise<unknown> {
    const t0 = Date.now();
    serverLog("info", "git", `${action} 开始`, { projectId, meta: metaIn });
    try {
      const result = await fn();
      serverLog("info", "git", `${action} 成功 (${Date.now() - t0}ms)`, {
        projectId,
        meta: metaIn,
      });
      return reply.send(result);
    } catch (err) {
      const e = err as Error;
      serverLog("error", "git", `${action} 失败: ${e?.message ?? String(err)}`, {
        projectId,
        meta: {
          ...metaIn,
          error: { name: e?.name, message: e?.message },
        },
      });
      return sendGitError(reply, err);
    }
  }

  // ---------- /pull ----------
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/pull",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(reply, proj.id, "pull", undefined, () => pullCurrent(proj.path));
    },
  );

  // ---------- /push ----------
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/push",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(reply, proj.id, "push", undefined, () => pushCurrent(proj.path));
    },
  );

  // ---------- /fetch ----------
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/fetch",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(reply, proj.id, "fetch", undefined, () => fetchAll(proj.path));
    },
  );

  // ---------- /branches/create ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/branches/create",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = BranchCreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(
        reply,
        proj.id,
        "branch-create",
        { branch: parsed.data.branch, checkout: parsed.data.checkout === true },
        () =>
          createBranch(proj.path, parsed.data.branch, {
            checkout: parsed.data.checkout === true,
          }),
      );
    },
  );

  // ---------- /branches/delete ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/branches/delete",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = BranchDeleteBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(
        reply,
        proj.id,
        "branch-delete",
        { branch: parsed.data.branch, force: parsed.data.force === true },
        () =>
          deleteBranch(proj.path, parsed.data.branch, {
            force: parsed.data.force === true,
          }),
      );
    },
  );

  // ---------- /branches/checkout ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/branches/checkout",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = BranchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(
        reply,
        proj.id,
        "checkout",
        { branch: parsed.data.branch },
        () => checkoutBranch(proj.path, parsed.data.branch),
      );
    },
  );

  // ---------- /merge ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/merge",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = BranchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(
        reply,
        proj.id,
        "merge",
        { branch: parsed.data.branch },
        () => mergeBranch(proj.path, parsed.data.branch),
      );
    },
  );

  // ---------- /stashes (GET list) ----------
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/stashes",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        if (!(await isGitRepo(proj.path))) return reply.send([]);
        return reply.send(await listStashes(proj.path));
      } catch (err) {
        return sendGitError(reply, err);
      }
    },
  );

  // ---------- /stash (POST create) ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/stash",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = StashCreateBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(
        reply,
        proj.id,
        "stash-create",
        { hasMessage: !!parsed.data.message },
        () => createStash(proj.path, parsed.data.message),
      );
    },
  );

  // ---------- /stash/pop ----------
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/stash/pop",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(reply, proj.id, "stash-pop", undefined, () => popStash(proj.path));
    },
  );

  // ---------- /reset-soft (undo last commit, keep changes staged) ----------
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/reset-soft",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      if (!(await isGitRepo(proj.path))) {
        return reply.code(400).send({ error: "not_a_git_repo" });
      }
      return runLogged(
        reply,
        proj.id,
        "reset-soft",
        undefined,
        () => resetSoftLastCommit(proj.path),
      );
    },
  );
}
