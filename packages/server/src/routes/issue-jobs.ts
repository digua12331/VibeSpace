import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getProject } from "../db.js";
import { issueJobs, type IssueJobState } from "../issue-jobs.js";
import {
  buildIssuePrompt,
  ISSUE_DONE_MARKER,
  ISSUE_STUCK_MARKER,
} from "../issue-prompt.js";
import { runVerify } from "../issue-verify.js";
import { readIssues } from "../issues-service.js";
import { serverLog } from "../log-bus.js";
import { broadcast } from "../ws-hub.js";
import {
  spawnWorktreeJob,
  type WorktreeJobSpawnInfo,
} from "../worktree-session-runner.js";

const BATCH_DEFAULT_CONCURRENCY = 3;
const BATCH_MAX_CONCURRENCY = 5;

const BatchDispatchSchema = z.object({
  issueHashes: z.array(z.string().min(8).max(32)).min(1).max(20),
  maxConcurrency: z
    .number()
    .int()
    .min(1)
    .max(BATCH_MAX_CONCURRENCY)
    .optional(),
});

interface IssueJobMeta {
  jobId: string;
  projectId: string;
  issueHash: string;
  issueText: string;
  worktreePath: string;
  branch: string;
  sessionId: string;
  startedAt: number;
}

function issueJobsDir(projectPath: string): string {
  return join(projectPath, ".aimon", "issue-jobs");
}

async function writeJobMeta(
  projectPath: string,
  meta: IssueJobMeta,
): Promise<void> {
  const dir = issueJobsDir(projectPath);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${meta.jobId}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

async function deleteJobMeta(
  projectPath: string,
  jobId: string,
): Promise<void> {
  try {
    await unlink(join(issueJobsDir(projectPath), `${jobId}.json`));
  } catch {
    /* already gone */
  }
}

async function loadOrphans(projectPath: string): Promise<IssueJobMeta[]> {
  const dir = issueJobsDir(projectPath);
  if (!existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    const out: IssueJobMeta[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf8");
        out.push(JSON.parse(raw) as IssueJobMeta);
      } catch {
        /* skip corrupt entry */
      }
    }
    return out;
  } catch {
    return [];
  }
}

interface GitCmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(cwd: string, args: string[]): Promise<GitCmdResult> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => (stdout += c.toString("utf8")));
    proc.stderr?.on("data", (c) => (stderr += c.toString("utf8")));
    proc.on("error", (err) => {
      stderr += `\n[spawn error] ${err.message}`;
    });
    proc.on("exit", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function runVerifyPipeline(
  jobId: string,
  projectPath: string,
  worktreePath: string,
): Promise<void> {
  issueJobs.markVerifying(jobId);
  const result = await runVerify(worktreePath, projectPath, (chunk) => {
    issueJobs.appendVerifyLog(jobId, chunk);
  });
  if (result.ok) {
    issueJobs.markReviewReady(jobId);
  } else {
    issueJobs.markFailed(
      jobId,
      `verify failed at ${result.failedStep}: ${result.errorTail.slice(-300)}`,
    );
  }
}

async function dispatchOne(
  app: FastifyInstance,
  projectId: string,
  projectPath: string,
  issueHash: string,
  issueText: string,
  issueLine: number,
): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  if (issueJobs.hasLiveJobForIssue(projectId, issueHash)) {
    return { ok: false, reason: "already-live" };
  }

  // jobId is filled in once the manager registers the row. The callbacks
  // close over the binding rather than the value because spawnWorktreeJob
  // wires PTY listeners synchronously; the marker can theoretically fire
  // before this function returns. The setTimeout-gated prompt injection
  // (1500ms) plus the synchronous register() below make this very unlikely
  // in practice, but the guard keeps us correct under load.
  let registeredJobId: string | null = null;
  const onMarkerDone = (info: WorktreeJobSpawnInfo): void => {
    if (!registeredJobId) {
      serverLog("warn", "issues", "DONE marker fired before register", {
        projectId,
        sessionId: info.sessionId,
      });
      return;
    }
    void runVerifyPipeline(registeredJobId, projectPath, info.worktreePath);
  };
  const onMarkerStuck = (
    _info: WorktreeJobSpawnInfo,
    reason: string,
  ): void => {
    if (!registeredJobId) return;
    issueJobs.markFailed(registeredJobId, `stuck: ${reason}`);
  };
  const onSessionExit = (_info: WorktreeJobSpawnInfo): void => {
    if (!registeredJobId) return;
    const job = issueJobs.get(registeredJobId);
    if (job?.state === "running" || job?.state === "pending") {
      issueJobs.markCancelled(registeredJobId, "session ended before marker");
    }
  };

  const prompt = buildIssuePrompt({ issueText, issueLine, issueHash });
  const spawnResult = await spawnWorktreeJob({
    app,
    projectId,
    agent: "claude",
    prompt,
    markerDone: ISSUE_DONE_MARKER,
    markerStuck: ISSUE_STUCK_MARKER,
    jobLabel: `issue-job:${issueHash.slice(0, 8)}`,
    onMarkerDone,
    onMarkerStuck,
    onSessionExitBeforeMarker: onSessionExit,
  });

  if (!spawnResult.ok) {
    return { ok: false, reason: spawnResult.reason };
  }

  const job = issueJobs.register({
    projectId,
    issueHash,
    issueText,
    worktreePath: spawnResult.info.worktreePath,
    branch: spawnResult.info.branch,
  });
  registeredJobId = job.jobId;
  issueJobs.markRunning(job.jobId, spawnResult.info.sessionId);

  await writeJobMeta(projectPath, {
    jobId: job.jobId,
    projectId,
    issueHash,
    issueText,
    worktreePath: spawnResult.info.worktreePath,
    branch: spawnResult.info.branch,
    sessionId: spawnResult.info.sessionId,
    startedAt: job.startedAt,
  });

  return { ok: true, jobId: job.jobId };
}

// Bridge IssueJobManager events to WS broadcast. Wired once on first register.
let busWired = false;
function wireIssueJobBus(): void {
  if (busWired) return;
  busWired = true;
  issueJobs.on(
    "state-change",
    (jobId: string, newState: IssueJobState, oldState: IssueJobState) => {
      const job = issueJobs.get(jobId);
      if (!job) return;
      broadcast({
        type: "issue-job-state",
        jobId,
        state: newState,
        oldState,
        job,
      });
    },
  );
  issueJobs.on("verify-log", (jobId: string, chunk: string) => {
    broadcast({ type: "issue-job-verify-log", jobId, chunk });
  });
  issueJobs.on("remove", (jobId: string) => {
    broadcast({ type: "issue-job-remove", jobId });
  });
}

export async function registerIssueJobsRoutes(
  app: FastifyInstance,
): Promise<void> {
  wireIssueJobBus();
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/issue-jobs",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });

      // Lazy orphan re-import. The worktree must still exist on disk;
      // otherwise the meta is stale and we drop it.
      const orphans = await loadOrphans(proj.path);
      for (const o of orphans) {
        const dup = issueJobs
          .list(proj.id)
          .find((j) => j.issueHash === o.issueHash);
        if (dup) continue;
        if (!existsSync(o.worktreePath)) {
          await deleteJobMeta(proj.path, o.jobId);
          continue;
        }
        issueJobs.registerOrphan({
          projectId: proj.id,
          issueHash: o.issueHash,
          issueText: o.issueText,
          worktreePath: o.worktreePath,
          branch: o.branch,
        });
      }

      return reply.send({ jobs: issueJobs.list(proj.id) });
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/issues/batch-dispatch",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });

      const parsed = BatchDispatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const { issueHashes } = parsed.data;

      const active = issueJobs.countActive(proj.id);
      if (active + issueHashes.length > BATCH_MAX_CONCURRENCY) {
        return reply.code(409).send({
          error: "pool_full",
          detail: `active=${active}, requested=${issueHashes.length}, pool=${BATCH_MAX_CONCURRENCY}`,
        });
      }

      const payload = await readIssues(proj.path);
      const itemsByHash = new Map(payload.items.map((it) => [it.hash, it]));

      serverLog("info", "issues", "batch-dispatch 开始", {
        projectId: proj.id,
        meta: { issueHashes, count: issueHashes.length },
      });
      const t0 = Date.now();

      const results: Array<{
        issueHash: string;
        ok: boolean;
        jobId?: string;
        reason?: string;
      }> = [];

      for (const hash of issueHashes) {
        const item = itemsByHash.get(hash);
        if (!item) {
          results.push({ issueHash: hash, ok: false, reason: "not-found" });
          continue;
        }
        if (item.done) {
          results.push({ issueHash: hash, ok: false, reason: "already-done" });
          continue;
        }
        if (!item.auto) {
          results.push({ issueHash: hash, ok: false, reason: "not-auto" });
          continue;
        }
        const r = await dispatchOne(
          app,
          proj.id,
          proj.path,
          hash,
          item.text,
          item.line,
        );
        if (r.ok) {
          results.push({ issueHash: hash, ok: true, jobId: r.jobId });
        } else {
          results.push({ issueHash: hash, ok: false, reason: r.reason });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      serverLog(
        "info",
        "issues",
        `batch-dispatch 成功 (${Date.now() - t0}ms)`,
        {
          projectId: proj.id,
          meta: { ok: okCount, total: results.length },
        },
      );

      return reply.send({ results });
    },
  );

  app.post<{ Params: { id: string; jobId: string } }>(
    "/api/projects/:id/issue-jobs/:jobId/approve",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const job = issueJobs.get(req.params.jobId);
      if (!job || job.projectId !== proj.id) {
        return reply.code(404).send({ error: "job_not_found" });
      }
      if (job.state !== "review-ready" && job.state !== "unknown") {
        return reply.code(409).send({
          error: "wrong_state",
          detail: `cannot approve from state '${job.state}'`,
        });
      }

      serverLog("info", "issues", "approve 开始", {
        projectId: proj.id,
        meta: { jobId: job.jobId, branch: job.branch },
      });
      const t0 = Date.now();

      const merge = await runGit(proj.path, [
        "merge",
        "--no-ff",
        "--no-edit",
        job.branch,
      ]);
      if (!merge.ok) {
        issueJobs.markMergeConflict(
          job.jobId,
          (merge.stderr || merge.stdout).slice(-500),
        );
        serverLog("error", "issues", "approve 失败: merge conflict", {
          projectId: proj.id,
          meta: { jobId: job.jobId, stderr: merge.stderr.slice(-300) },
        });
        return reply.code(409).send({
          error: "merge_conflict",
          detail: (merge.stderr || merge.stdout).slice(-500),
        });
      }

      const wt = await runGit(proj.path, [
        "worktree",
        "remove",
        "--force",
        job.worktreePath,
      ]);
      if (!wt.ok) {
        // Merge succeeded but worktree cleanup failed — log and continue.
        serverLog(
          "warn",
          "issues",
          "approve worktree-remove 失败（merge 已成功）",
          {
            projectId: proj.id,
            meta: { jobId: job.jobId, stderr: wt.stderr.slice(-300) },
          },
        );
      }

      await deleteJobMeta(proj.path, job.jobId);
      issueJobs.remove(job.jobId);

      serverLog("info", "issues", `approve 成功 (${Date.now() - t0}ms)`, {
        projectId: proj.id,
        meta: { jobId: job.jobId, branch: job.branch },
      });
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string; jobId: string } }>(
    "/api/projects/:id/issue-jobs/:jobId",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      const job = issueJobs.get(req.params.jobId);
      if (!job || job.projectId !== proj.id) {
        return reply.code(404).send({ error: "job_not_found" });
      }

      serverLog("info", "issues", "reject 开始", {
        projectId: proj.id,
        meta: { jobId: job.jobId, state: job.state },
      });
      const t0 = Date.now();

      // Best-effort cleanup. Worktree may already be gone if user removed it
      // out of band; we still want to drop the metadata + manager entry.
      const wt = await runGit(proj.path, [
        "worktree",
        "remove",
        "--force",
        job.worktreePath,
      ]);
      if (!wt.ok) {
        serverLog("warn", "issues", "reject worktree-remove 失败", {
          projectId: proj.id,
          meta: { jobId: job.jobId, stderr: wt.stderr.slice(-300) },
        });
      }

      await deleteJobMeta(proj.path, job.jobId);
      issueJobs.remove(job.jobId);

      serverLog("info", "issues", `reject 成功 (${Date.now() - t0}ms)`, {
        projectId: proj.id,
        meta: { jobId: job.jobId },
      });
      return reply.send({ ok: true });
    },
  );
}
