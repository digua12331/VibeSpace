import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// packages/server/src/worktree-paths.ts → packages/server/
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, "..");
const WORKTREE_ROOT = resolve(SERVER_ROOT, "data", "worktrees");

export function getWorktreeRoot(): string {
  return WORKTREE_ROOT;
}

export function getWorktreePath(projectId: string, sessionId: string): string {
  return resolve(WORKTREE_ROOT, projectId, sessionId);
}

export function getProjectWorktreeDir(projectId: string): string {
  return resolve(WORKTREE_ROOT, projectId);
}

/**
 * Short branch name for an isolated session: `agent/<sessionId.slice(0,8)>`.
 * Picks the first 8 chars of the session id (which is a 16-char nanoid) to
 * keep the branch readable in `git branch -a` while staying unique within a
 * project.
 */
export function buildWorktreeBranch(sessionId: string): string {
  return `agent/${sessionId.slice(0, 8)}`;
}
