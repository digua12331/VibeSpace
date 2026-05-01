import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import {
  dirname,
  join as joinPath,
  resolve as resolvePath,
  relative as relativePath,
  sep,
} from "node:path";
import simpleGit, { type SimpleGit, type SimpleGitOptions } from "simple-git";

// ---------- Types ----------

export type ChangeStatus = "M" | "A" | "D" | "R" | "C" | "U" | "?";

export interface ChangeEntry {
  path: string;
  status: ChangeStatus;
  renamedFrom?: string;
}

export interface ChangesResult {
  enabled: true;
  branch: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  staged: ChangeEntry[];
  unstaged: ChangeEntry[];
  untracked: ChangeEntry[];
}

export interface NotGitRepoResult {
  enabled: false;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  parents: string[];
}

export interface CommitFile {
  path: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  renamedFrom?: string;
}

export interface CommitDetail extends CommitSummary {
  files: CommitFile[];
}

export type Ref = "HEAD" | "WORKTREE" | "INDEX" | string;

export interface FileContent {
  path: string;
  ref: Ref;
  size: number;
  truncated: boolean;
  encoding: "utf8" | "base64";
  content: string;
  language: string;
}

export interface DiffResult {
  path: string;
  from: Ref;
  to: Ref;
  patch: string;
  isBinary: boolean;
}

export interface BranchRef {
  name: string;
  shortName: string;
  /** "local" | "remote" | "tag" */
  kind: "local" | "remote" | "tag";
  sha: string;
  /** True for the HEAD of this repo (only one local branch has it). */
  isHead: boolean;
}

/** Simplified commit node for graph rendering. */
export interface GraphCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[]; // branch/tag names pointing at this commit
  isHead: boolean;
}

export interface CommitInput {
  message: string;
  /** If true, pass --amend. */
  amend?: boolean;
  /** If true, pass --allow-empty. Otherwise empty commits fail. */
  allowEmpty?: boolean;
}

export interface CommitResult {
  sha: string;
  shortSha: string;
  summary: string;
}

export interface PullResult {
  /** Raw stdout from `git pull` (truncated to 4 KB). */
  output: string;
  /** True when the pull completed without conflicts. */
  ok: true;
}

export interface PushResult {
  output: string;
  ok: true;
}

export interface FetchResult {
  output: string;
  ok: true;
}

export interface MergeResult {
  output: string;
  ok: true;
}

export interface StashEntry {
  /** Stash ref name, e.g. `stash@{0}`. */
  ref: string;
  /** Branch the stash was made on, if known. */
  branch: string | null;
  /** Subject line of the stash commit (after `WIP on <branch>:`). */
  subject: string;
  /** ISO timestamp. */
  date: string;
}

export interface StashOpResult {
  output: string;
  ok: true;
}

export interface BranchOpResult {
  branch: string;
  /** What we did: `created` | `deleted` | `checked-out` | `merged`. */
  action: "created" | "deleted" | "checked-out" | "merged";
}

export interface ResetResult {
  /** New HEAD sha after the reset. */
  head: string;
  /** Sha that was at HEAD before the reset (the "undone" commit). */
  previousHead: string;
}

// ---------- Errors ----------

export class GitServiceError extends Error {
  constructor(
    public code:
      | "not_a_git_repo"
      | "path_outside_project"
      | "path_not_found"
      | "invalid_ref"
      | "too_large"
      | "git_failed",
    message: string,
    public httpStatus: number = 400,
  ) {
    super(message);
    this.name = "GitServiceError";
  }
}

// ---------- Constants ----------

const MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB — larger files are truncated
const STATUS_CACHE_TTL_MS = 1500;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

// ---------- SimpleGit factory (one instance per project root) ----------

const gitInstances = new Map<string, SimpleGit>();

function sanitizedGitEnv(): NodeJS.ProcessEnv {
  // simple-git refuses to spawn when "dangerous" vars leak in (GIT_EDITOR,
  // EDITOR, GIT_PAGER, PAGER, GIT_ASKPASS, SSH_ASKPASS, GIT_SSH_COMMAND,
  // GIT_EXTERNAL_DIFF, ...). Rather than chase the denylist, we start from
  // an empty env and re-add only what git genuinely needs to run.
  const allowed = new Set([
    "PATH", "Path", // Windows preserves original casing
    "SYSTEMROOT", "SystemRoot",
    "WINDIR", "windir",
    "TEMP", "TMP", "TMPDIR",
    "HOME", "USERPROFILE",
    "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA",
    "COMSPEC", "PATHEXT",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  ]);
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    if (allowed.has(k) || allowed.has(k.toUpperCase())) out[k] = v;
  }
  out.LC_ALL = "C";
  out.GIT_OPTIONAL_LOCKS = "0";
  return out;
}

function gitFor(cwd: string): SimpleGit {
  let g = gitInstances.get(cwd);
  if (g) return g;
  const opts: Partial<SimpleGitOptions> = {
    baseDir: cwd,
    binary: "git",
    maxConcurrentProcesses: 4,
    trimmed: false,
  };
  g = simpleGit(opts).env(sanitizedGitEnv());
  gitInstances.set(cwd, g);
  return g;
}

export function forgetProject(cwd: string): void {
  gitInstances.delete(cwd);
  for (const key of statusCache.keys()) {
    if (key.startsWith(cwd + "\u0000")) statusCache.delete(key);
  }
}

// ---------- Safety helpers ----------

export function safeResolve(projectPath: string, input: string): string {
  const normalizedInput = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const absProject = resolvePath(projectPath);
  const abs = resolvePath(absProject, normalizedInput);
  const rel = relativePath(absProject, abs);
  if (rel.startsWith("..") || resolvePath(absProject, rel) !== abs) {
    throw new GitServiceError(
      "path_outside_project",
      `path escapes project: ${input}`,
      400,
    );
  }
  return abs;
}

export function toRepoRelative(projectPath: string, abs: string): string {
  return relativePath(resolvePath(projectPath), abs).split(sep).join("/");
}

function assertRef(ref: string): Ref {
  if (ref === "HEAD" || ref === "WORKTREE" || ref === "INDEX") return ref;
  if (SHA_RE.test(ref)) return ref.toLowerCase();
  throw new GitServiceError("invalid_ref", `invalid ref: ${ref}`, 400);
}

// ---------- Repo detection ----------

export async function isGitRepo(projectPath: string): Promise<boolean> {
  if (!existsSync(projectPath)) return false;
  try {
    const inside = await gitFor(projectPath).revparse(["--is-inside-work-tree"]);
    return inside.trim() === "true";
  } catch {
    return false;
  }
}

// ---------- Working-tree status ----------

interface CacheEntry {
  ts: number;
  value: ChangesResult;
}

const statusCache = new Map<string, CacheEntry>();

function mapPorcelainCode(c: string): ChangeStatus {
  const ch = c?.trim()?.charAt(0) ?? "";
  switch (ch) {
    case "M": return "M";
    case "A": return "A";
    case "D": return "D";
    case "R": return "R";
    case "C": return "C";
    case "U": return "U";
    case "?": return "?";
    default: return "M";
  }
}

export async function getChanges(projectPath: string): Promise<ChangesResult> {
  const cacheKey = `${projectPath}\u0000status`;
  const now = Date.now();
  const cached = statusCache.get(cacheKey);
  if (cached && now - cached.ts < STATUS_CACHE_TTL_MS) return cached.value;

  const g = gitFor(projectPath);
  const s = await g.status();

  const staged: ChangeEntry[] = [];
  const unstaged: ChangeEntry[] = [];
  const untracked: ChangeEntry[] = [];

  // simple-git's status() already splits these, but we want our own ChangeStatus shape.
  for (const f of s.files) {
    const idx = (f.index ?? " ").trim();
    const wt = (f.working_dir ?? " ").trim();
    if (idx === "?" && wt === "?") {
      untracked.push({ path: f.path, status: "?" });
      continue;
    }
    if (idx && idx !== " ") {
      staged.push({
        path: f.path,
        status: mapPorcelainCode(idx),
        ...(f.from ? { renamedFrom: f.from } : {}),
      });
    }
    if (wt && wt !== " ") {
      unstaged.push({
        path: f.path,
        status: mapPorcelainCode(wt),
        ...(f.from ? { renamedFrom: f.from } : {}),
      });
    }
  }

  const value: ChangesResult = {
    enabled: true,
    branch: s.current ?? null,
    ahead: s.ahead ?? 0,
    behind: s.behind ?? 0,
    detached: s.detached ?? false,
    staged,
    unstaged,
    untracked,
  };
  statusCache.set(cacheKey, { ts: now, value });
  return value;
}

// ---------- Commits ----------

export async function listCommits(
  projectPath: string,
  opts: { limit?: number; branch?: string } = {},
): Promise<CommitSummary[]> {
  const g = gitFor(projectPath);
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 200));
  const args: string[] = ["log", `--max-count=${limit}`, "--date=iso-strict"];
  if (opts.branch) args.push(opts.branch);
  args.push(
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%s%x1f%b%x1e",
  );
  const raw = await g.raw(args);
  return parseCommitLog(raw);
}

function parseCommitLog(raw: string): CommitSummary[] {
  return raw
    .split("\x1e")
    .map((chunk) => chunk.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((chunk) => {
      const [sha, shortSha, author, email, date, parents, subject, body] =
        chunk.split("\x1f");
      return {
        sha,
        shortSha,
        author,
        email,
        date,
        subject,
        body: (body ?? "").trim(),
        parents: (parents ?? "").trim().split(/\s+/).filter(Boolean),
      } satisfies CommitSummary;
    });
}

export async function getCommit(
  projectPath: string,
  shaInput: string,
): Promise<CommitDetail> {
  const sha = assertRef(shaInput);
  if (sha === "HEAD" || sha === "WORKTREE" || sha === "INDEX") {
    // HEAD is acceptable here; WORKTREE/INDEX are not real commits.
    if (sha !== "HEAD") {
      throw new GitServiceError("invalid_ref", `not a commit: ${shaInput}`, 400);
    }
  }
  const g = gitFor(projectPath);
  const [summary] = await listCommits(projectPath, { limit: 1, branch: sha });
  if (!summary) {
    throw new GitServiceError("git_failed", `commit not found: ${shaInput}`, 404);
  }
  const raw = await g.raw([
    "show",
    "--numstat",
    "--name-status",
    "--format=",
    sha,
  ]);
  const files = parseNumstatNameStatus(raw);
  return { ...summary, files };
}

function parseNumstatNameStatus(raw: string): CommitFile[] {
  // git show with both --numstat and --name-status prints numstat first, then name-status.
  // Numstat lines: `<add>\t<del>\t<path>` (binary uses `-\t-\t<path>`).
  // Name-status lines: `<code>\t<path>` or `R<score>\t<from>\t<to>` / `C<score>\t<from>\t<to>`.
  const numstat = new Map<string, { additions: number; deletions: number }>();
  const files: CommitFile[] = [];
  const lines = raw.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length >= 3 && /^-?\d+$/.test(parts[0]) && /^-?\d+$/.test(parts[1])) {
      const add = parts[0] === "-" ? 0 : Number(parts[0]);
      const del = parts[1] === "-" ? 0 : Number(parts[1]);
      const path = parts[parts.length - 1];
      numstat.set(path, { additions: add, deletions: del });
      continue;
    }
    const code = parts[0]?.charAt(0);
    if (!code) continue;
    if ((code === "R" || code === "C") && parts.length >= 3) {
      const from = parts[1];
      const to = parts[2];
      const n = numstat.get(to) ?? { additions: 0, deletions: 0 };
      files.push({
        path: to,
        status: code,
        renamedFrom: from,
        additions: n.additions,
        deletions: n.deletions,
      });
    } else if (parts.length >= 2) {
      const path = parts[1];
      const n = numstat.get(path) ?? { additions: 0, deletions: 0 };
      files.push({
        path,
        status: mapPorcelainCode(code),
        additions: n.additions,
        deletions: n.deletions,
      });
    }
  }
  return files;
}

// ---------- File content ----------

const EXT_TO_LANG: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  json: "json", md: "md", markdown: "md", yml: "yaml", yaml: "yaml",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  html: "html", css: "css", scss: "scss", less: "less",
  sql: "sql", toml: "toml", xml: "xml", vue: "vue", svelte: "svelte",
  lua: "lua", php: "php", swift: "swift", kt: "kotlin", dart: "dart",
};

function languageForPath(p: string): string {
  const lower = p.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return EXT_TO_LANG[ext] ?? "plaintext";
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function readFileAtRef(
  projectPath: string,
  input: { path: string; ref?: string },
): Promise<FileContent> {
  const refRaw = input.ref ?? "WORKTREE";
  const ref = assertRef(refRaw);
  const abs = safeResolve(projectPath, input.path);
  const relPosix = toRepoRelative(projectPath, abs);
  const language = languageForPath(relPosix);

  if (ref === "WORKTREE") {
    if (!existsSync(abs)) {
      throw new GitServiceError("path_not_found", `no such file: ${relPosix}`, 404);
    }
    const st = statSync(abs);
    if (!st.isFile()) {
      throw new GitServiceError("path_not_found", `not a regular file: ${relPosix}`, 400);
    }
    const truncated = st.size > MAX_FILE_BYTES;
    const buf = await readFile(abs);
    const sliced = truncated ? buf.subarray(0, MAX_FILE_BYTES) : buf;
    const binary = looksBinary(sliced);
    return {
      path: relPosix,
      ref: "WORKTREE",
      size: st.size,
      truncated,
      encoding: binary ? "base64" : "utf8",
      content: binary ? sliced.toString("base64") : sliced.toString("utf8"),
      language: binary ? "plaintext" : language,
    };
  }

  // INDEX: `git show :path`; arbitrary sha or HEAD: `git show sha:path`.
  const spec = ref === "INDEX" ? `:${relPosix}` : `${ref}:${relPosix}`;
  const g = gitFor(projectPath);
  let raw: Buffer;
  try {
    const s = await g.raw(["show", spec]);
    raw = Buffer.from(s, "utf8");
  } catch (err) {
    throw new GitServiceError(
      "path_not_found",
      `git show failed for ${spec}: ${(err as Error).message}`,
      404,
    );
  }
  const truncated = raw.length > MAX_FILE_BYTES;
  const sliced = truncated ? raw.subarray(0, MAX_FILE_BYTES) : raw;
  const binary = looksBinary(sliced);
  return {
    path: relPosix,
    ref,
    size: raw.length,
    truncated,
    encoding: binary ? "base64" : "utf8",
    content: binary ? sliced.toString("base64") : sliced.toString("utf8"),
    language: binary ? "plaintext" : language,
  };
}

// ---------- Diff ----------

export async function getDiff(
  projectPath: string,
  input: { path: string; from?: string; to?: string },
): Promise<DiffResult> {
  const from = assertRef(input.from ?? "HEAD");
  const to = assertRef(input.to ?? "WORKTREE");
  const abs = safeResolve(projectPath, input.path);
  const relPosix = toRepoRelative(projectPath, abs);

  const g = gitFor(projectPath);
  const args: string[] = ["diff", "--no-color"];

  if (from === "HEAD" && to === "WORKTREE") {
    args.push("HEAD", "--", relPosix);
  } else if (from === "HEAD" && to === "INDEX") {
    args.push("--cached", "HEAD", "--", relPosix);
  } else if (from === "INDEX" && to === "WORKTREE") {
    args.push("--", relPosix);
  } else if (from === "WORKTREE" || to === "WORKTREE" || from === "INDEX" || to === "INDEX") {
    throw new GitServiceError(
      "invalid_ref",
      `unsupported ref pair: from=${from} to=${to}`,
      400,
    );
  } else {
    args.push(from, to, "--", relPosix);
  }

  const rawPatch = await g.raw(args);
  // Normalize to LF so browser-side diff viewers don't get fooled by a
  // trailing \r on every line (which happens on Windows when git emits CRLF).
  const patch = rawPatch.replace(/\r\n?/g, "\n");
  const isBinary = /Binary files .* differ/.test(patch);
  return { path: relPosix, from, to, patch, isBinary };
}

// ---------- Write operations (stage / unstage / discard / commit) ----------

function resolveRepoPaths(projectPath: string, paths: string[]): string[] {
  if (paths.length === 0) {
    throw new GitServiceError("invalid_ref", "empty path list", 400);
  }
  return paths.map((p) => {
    const abs = safeResolve(projectPath, p);
    return toRepoRelative(projectPath, abs);
  });
}

export function bustStatusCache(projectPath: string): void {
  const cacheKey = `${projectPath}\u0000status`;
  statusCache.delete(cacheKey);
}

export async function stagePaths(
  projectPath: string,
  paths: string[],
): Promise<{ staged: string[] }> {
  const rels = resolveRepoPaths(projectPath, paths);
  const g = gitFor(projectPath);
  await g.raw(["add", "--", ...rels]);
  bustStatusCache(projectPath);
  return { staged: rels };
}

export async function unstagePaths(
  projectPath: string,
  paths: string[],
): Promise<{ unstaged: string[] }> {
  const rels = resolveRepoPaths(projectPath, paths);
  const g = gitFor(projectPath);
  // `git reset HEAD --` works before first commit and after; use `restore --staged`
  // when HEAD exists, fall back to `reset` otherwise.
  try {
    await g.raw(["restore", "--staged", "--", ...rels]);
  } catch {
    await g.raw(["reset", "HEAD", "--", ...rels]);
  }
  bustStatusCache(projectPath);
  return { unstaged: rels };
}

/**
 * Discard working-tree changes for tracked files. For untracked files (status '?'),
 * the caller must pass them in `untracked` so we can `git clean` them.
 *
 * DESTRUCTIVE: user should have confirmed in UI before calling.
 */
export async function discardPaths(
  projectPath: string,
  input: { tracked: string[]; untracked: string[] },
): Promise<{ discarded: string[] }> {
  const trackedRels = input.tracked.length
    ? resolveRepoPaths(projectPath, input.tracked)
    : [];
  const untrackedRels = input.untracked.length
    ? resolveRepoPaths(projectPath, input.untracked)
    : [];
  if (trackedRels.length === 0 && untrackedRels.length === 0) {
    throw new GitServiceError("invalid_ref", "nothing to discard", 400);
  }
  const g = gitFor(projectPath);
  if (trackedRels.length > 0) {
    try {
      await g.raw(["restore", "--staged", "--worktree", "--source=HEAD", "--", ...trackedRels]);
    } catch {
      await g.raw(["checkout", "HEAD", "--", ...trackedRels]);
    }
  }
  if (untrackedRels.length > 0) {
    // Remove untracked files, one at a time via `clean -f -- <path>` so paths
    // with special characters are treated as literals.
    for (const p of untrackedRels) {
      await g.raw(["clean", "-f", "--", p]);
    }
  }
  bustStatusCache(projectPath);
  return { discarded: [...trackedRels, ...untrackedRels] };
}

export async function createCommit(
  projectPath: string,
  input: CommitInput,
): Promise<CommitResult> {
  const message = (input.message ?? "").trim();
  if (!message) {
    throw new GitServiceError("invalid_ref", "empty commit message", 400);
  }
  const args = ["commit", "-m", message];
  if (input.amend) args.push("--amend");
  if (input.allowEmpty) args.push("--allow-empty");
  const g = gitFor(projectPath);
  try {
    await g.raw(args);
  } catch (err) {
    throw new GitServiceError(
      "git_failed",
      `commit failed: ${(err as Error).message}`,
      400,
    );
  }
  bustStatusCache(projectPath);
  const sha = (await g.raw(["rev-parse", "HEAD"])).trim();
  const summary = (await g.raw(["log", "-n", "1", "--format=%s", sha])).trim();
  return { sha, shortSha: sha.slice(0, 7), summary };
}

// ---------- Branches / refs ----------

export async function listBranches(
  projectPath: string,
): Promise<BranchRef[]> {
  const g = gitFor(projectPath);
  // NOTE: for-each-ref's --format language does NOT interpret %x1f byte
  // escapes (that's git log only). Use a literal tab — refnames / object
  // hashes / the HEAD marker ('*' or ' ') cannot contain tabs.
  const raw = await g.raw([
    "for-each-ref",
    "--format=%(refname)\t%(objectname)\t%(HEAD)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  const rows: BranchRef[] = [];
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const [refname, sha, headMark] = line.split("\t");
    if (!refname || !sha) continue;
    let kind: BranchRef["kind"] = "local";
    let shortName = refname;
    if (refname.startsWith("refs/heads/")) {
      kind = "local";
      shortName = refname.slice("refs/heads/".length);
    } else if (refname.startsWith("refs/remotes/")) {
      kind = "remote";
      shortName = refname.slice("refs/remotes/".length);
    } else if (refname.startsWith("refs/tags/")) {
      kind = "tag";
      shortName = refname.slice("refs/tags/".length);
    }
    rows.push({
      name: refname,
      shortName,
      kind,
      sha,
      isHead: (headMark ?? "").trim() === "*",
    });
  }
  return rows;
}

// ---------- Project file tree (filesystem walk + git status overlay) ----------

export type ProjectFileGitStatus =
  | "clean"
  | "modified"
  | "staged"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted";

export interface ProjectFileEntry {
  /** Forward-slash relative path from the project root. */
  path: string;
  /** Null when the project is not a git repo. */
  git: ProjectFileGitStatus | null;
  /** True if the working-tree copy differs from its staged copy. */
  dirty: boolean;
  /** True if any version of this path is staged in the index. */
  staged: boolean;
}

export interface ProjectFilesResult {
  /** True if project is a git repo (and `git` fields are populated). */
  gitEnabled: boolean;
  files: ProjectFileEntry[];
  /**
   * Directories whose contents were intentionally skipped (e.g. node_modules).
   * Forward-slash relative paths. The UI shows them as dim, non-clickable
   * placeholder nodes so the user knows they exist without paying the scan
   * cost. Always present (possibly empty).
   */
  heavyDirs: string[];
  /** Total entries encountered before truncation (== files.length when not truncated). */
  total: number;
  truncated: boolean;
  /** The per-request cap that was in effect. */
  limit: number;
}

const PROJECT_FILES_DEFAULT_LIMIT = 20000;
const PROJECT_FILES_MAX_LIMIT = 50000;

// Directories we never descend into — listing them all produces tens of
// thousands of uninteresting files that blow past the limit and drown the
// tree. The UI still shows them as "placeholder" nodes so the user can
// see they exist; they just can't be expanded.
const HEAVY_DIR_NAMES = new Set([
  "node_modules",
  ".pnpm",
  "__pycache__",
  ".venv",
  "venv",
]);

async function walkProjectFiles(
  root: string,
  limit: number,
): Promise<{ paths: string[]; heavyDirs: string[]; truncated: boolean; total: number }> {
  const out: string[] = [];
  const heavyDirs: string[] = [];
  let truncated = false;
  let total = 0;
  // Iterative BFS to keep stack depth bounded on deep trees.
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // permission denied, race with deletion, etc.
    }
    for (const ent of entries) {
      const abs = joinPath(dir, ent.name);
      if (ent.isDirectory()) {
        // Never descend into git internals (root repo or submodules).
        if (ent.name === ".git") continue;
        if (HEAVY_DIR_NAMES.has(ent.name)) {
          heavyDirs.push(relativePath(root, abs).split(sep).join("/"));
          continue;
        }
        stack.push(abs);
        continue;
      }
      if (!ent.isFile() && !ent.isSymbolicLink()) continue;
      total++;
      if (out.length >= limit) {
        truncated = true;
        continue;
      }
      const rel = relativePath(root, abs).split(sep).join("/");
      out.push(rel);
    }
  }
  return { paths: out, heavyDirs, truncated, total };
}

function classifyGitStatus(
  idxRaw: string,
  wtRaw: string,
): { git: ProjectFileGitStatus; dirty: boolean; staged: boolean } {
  const idx = idxRaw === " " ? "" : idxRaw;
  const wt = wtRaw === " " ? "" : wtRaw;
  const staged = idx !== "" && idx !== "?";
  const dirty = wt !== "" && wt !== "?";
  // Conflicts: U in either column, or AA/DD combos.
  if (idx === "U" || wt === "U" || (idx === "A" && wt === "A") || (idx === "D" && wt === "D")) {
    return { git: "conflicted", dirty, staged };
  }
  if (idx === "?" && wt === "?") {
    return { git: "untracked", dirty: false, staged: false };
  }
  // Worktree takes precedence for "what does the user see right now".
  if (wt === "D" || idx === "D") return { git: "deleted", dirty, staged };
  if (wt === "M" || idx === "M") return { git: "modified", dirty, staged };
  if (idx === "A") return { git: "added", dirty, staged };
  if (idx === "R" || wt === "R") return { git: "renamed", dirty, staged };
  if (staged) return { git: "staged", dirty, staged };
  return { git: "modified", dirty, staged };
}

export async function listProjectFiles(
  projectPath: string,
  opts: { limit?: number } = {},
): Promise<ProjectFilesResult> {
  const absRoot = resolvePath(projectPath);
  if (!existsSync(absRoot)) {
    throw new GitServiceError("path_not_found", `project path not found: ${projectPath}`, 404);
  }
  const limit = Math.max(
    1,
    Math.min(opts.limit ?? PROJECT_FILES_DEFAULT_LIMIT, PROJECT_FILES_MAX_LIMIT),
  );

  const { paths, heavyDirs, truncated, total } = await walkProjectFiles(absRoot, limit);

  const gitEnabled = await isGitRepo(absRoot);
  const statusByPath = new Map<string, { git: ProjectFileGitStatus; dirty: boolean; staged: boolean }>();
  const deletedExtras: string[] = [];

  if (gitEnabled) {
    try {
      const s = await gitFor(absRoot).status();
      for (const f of s.files) {
        const idx = f.index ?? " ";
        const wt = f.working_dir ?? " ";
        const info = classifyGitStatus(idx, wt);
        statusByPath.set(f.path, info);
        // `git status` reports deletions even though the file no longer
        // exists on disk. Surface them at the top so the user can see
        // what's gone.
        if (info.git === "deleted" && !paths.includes(f.path)) {
          deletedExtras.push(f.path);
        }
      }
    } catch {
      // If `git status` blows up (corrupted repo etc.) we still return the
      // filesystem listing rather than failing the whole endpoint.
    }
  }

  const files: ProjectFileEntry[] = paths.map((p) => {
    const st = statusByPath.get(p);
    if (st) return { path: p, git: st.git, dirty: st.dirty, staged: st.staged };
    return {
      path: p,
      git: gitEnabled ? "clean" : null,
      dirty: false,
      staged: false,
    };
  });

  for (const p of deletedExtras) {
    const st = statusByPath.get(p);
    if (!st) continue;
    files.push({ path: p, git: st.git, dirty: st.dirty, staged: st.staged });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    gitEnabled,
    files,
    heavyDirs: heavyDirs.sort(),
    total: total + deletedExtras.length,
    truncated,
    limit,
  };
}

// ---------- Commit graph ----------

export async function getGraph(
  projectPath: string,
  opts: { limit?: number; all?: boolean } = {},
): Promise<GraphCommit[]> {
  const g = gitFor(projectPath);
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
  const args = [
    "log",
    `--max-count=${limit}`,
    "--date-order",
    "--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%s",
  ];
  if (opts.all !== false) args.push("--all");
  const raw = await g.raw(args);

  // Build ref map: sha -> [refShortNames]
  const refs = await listBranches(projectPath);
  const refMap = new Map<string, string[]>();
  let headSha: string | null = null;
  for (const r of refs) {
    const arr = refMap.get(r.sha) ?? [];
    arr.push(r.kind === "remote" ? r.shortName : r.shortName);
    refMap.set(r.sha, arr);
    if (r.isHead) headSha = r.sha;
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, parents, author, date, subject] = line.split("\x1f");
      const parentArr = (parents ?? "").trim().split(/\s+/).filter(Boolean);
      return {
        sha,
        shortSha,
        subject: subject ?? "",
        author: author ?? "",
        date: date ?? "",
        parents: parentArr,
        refs: refMap.get(sha) ?? [],
        isHead: sha === headSha,
      } satisfies GraphCommit;
    });
}

// ---------- Worktree ----------

export interface WorktreeEntry {
  /** Absolute path. */
  path: string;
  /** Commit sha at the worktree's HEAD. */
  head: string;
  /** Short branch name (no `refs/heads/` prefix), or null when detached. */
  branch: string | null;
  bare: boolean;
  detached: boolean;
}

export async function addWorktree(
  projectPath: string,
  worktreePath: string,
  branch: string,
  baseRef: string = "HEAD",
): Promise<void> {
  // git refuses to create the worktree if its parent directory is missing,
  // so ensure it exists first.
  await mkdir(dirname(worktreePath), { recursive: true });
  const g = gitFor(projectPath);
  try {
    await g.raw(["worktree", "add", "-b", branch, worktreePath, baseRef]);
  } catch (err) {
    throw new GitServiceError(
      "git_failed",
      `git worktree add failed: ${(err as Error).message}`,
      400,
    );
  }
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const g = gitFor(projectPath);
  const args = ["worktree", "remove"];
  if (opts.force) args.push("--force");
  args.push(worktreePath);
  try {
    await g.raw(args);
  } catch (err) {
    throw new GitServiceError(
      "git_failed",
      `git worktree remove failed: ${(err as Error).message}`,
      400,
    );
  }
  // Drop the cached SimpleGit instance + status cache for the removed cwd.
  forgetProject(worktreePath);
}

export async function listWorktrees(
  projectPath: string,
): Promise<WorktreeEntry[]> {
  const g = gitFor(projectPath);
  let raw: string;
  try {
    raw = await g.raw(["worktree", "list", "--porcelain"]);
  } catch {
    return [];
  }
  const out: WorktreeEntry[] = [];
  let cur: Partial<WorktreeEntry> = {};
  const flush = (): void => {
    if (cur.path) {
      out.push({
        path: cur.path,
        head: cur.head ?? "",
        branch: cur.branch ?? null,
        bare: cur.bare ?? false,
        detached: cur.detached ?? false,
      });
    }
    cur = {};
  };
  for (const line of raw.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      cur.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      cur.branch = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref;
    } else if (line === "bare") {
      cur.bare = true;
    } else if (line === "detached") {
      cur.detached = true;
    }
  }
  flush();
  return out;
}

// ---------- Remote / branch / stash / reset operations ----------

const REMOTE_TIMEOUT_MS = 60_000;
const LOCAL_TIMEOUT_MS = 15_000;
const STDERR_CAP_BYTES = 1024;
const VALID_BRANCH_RE = /^[A-Za-z0-9._/-][A-Za-z0-9._/-]{0,255}$/;

function assertBranchName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || !VALID_BRANCH_RE.test(trimmed) || trimmed.includes("..") || trimmed.endsWith(".lock")) {
    throw new GitServiceError("invalid_ref", `invalid branch name: ${name}`, 400);
  }
  return trimmed;
}

function clipStderr(s: string): string {
  if (s.length <= STDERR_CAP_BYTES) return s;
  return s.slice(0, STDERR_CAP_BYTES) + `\n…(truncated, ${s.length - STDERR_CAP_BYTES} more bytes)`;
}

/** Wrap a git operation in a hard timeout. simple-git lacks native timeout. */
async function withGitTimeout<T>(
  label: string,
  ms: number,
  fn: () => Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, rej) => {
        timer = setTimeout(
          () =>
            rej(
              new GitServiceError(
                "git_failed",
                `git ${label} timed out after ${ms}ms`,
                504,
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

async function runGitOrThrow(
  projectPath: string,
  label: string,
  args: string[],
  ms: number,
): Promise<string> {
  const g = gitFor(projectPath);
  try {
    const raw = await withGitTimeout(label, ms, () => g.raw(args));
    return clipStderr(normalizeNewlines(raw).trim());
  } catch (err) {
    if (err instanceof GitServiceError) throw err;
    const msg = clipStderr(normalizeNewlines((err as Error)?.message ?? String(err)));
    throw new GitServiceError("git_failed", `git ${label} failed: ${msg}`, 400);
  }
}

async function hasAnyRemote(projectPath: string): Promise<boolean> {
  try {
    const out = await gitFor(projectPath).raw(["remote"]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function isDetachedHead(projectPath: string): Promise<boolean> {
  try {
    const out = (await gitFor(projectPath).raw(["symbolic-ref", "-q", "HEAD"])).trim();
    return out.length === 0;
  } catch {
    return true;
  }
}

async function currentBranch(projectPath: string): Promise<string | null> {
  try {
    const out = (await gitFor(projectPath).raw(["symbolic-ref", "--short", "-q", "HEAD"])).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ---- Remote ops ----

export async function pullCurrent(projectPath: string): Promise<PullResult> {
  if (!(await hasAnyRemote(projectPath))) {
    throw new GitServiceError("git_failed", "no remote configured", 400);
  }
  if (await isDetachedHead(projectPath)) {
    throw new GitServiceError("git_failed", "cannot pull on detached HEAD", 400);
  }
  // --ff-only = safe, no silent rebase / merge commit.
  const output = await runGitOrThrow(projectPath, "pull", ["pull", "--ff-only"], REMOTE_TIMEOUT_MS);
  bustStatusCache(projectPath);
  return { output, ok: true };
}

export async function pushCurrent(projectPath: string): Promise<PushResult> {
  if (!(await hasAnyRemote(projectPath))) {
    throw new GitServiceError("git_failed", "no remote configured", 400);
  }
  const branch = await currentBranch(projectPath);
  if (!branch) {
    throw new GitServiceError("git_failed", "cannot push on detached HEAD", 400);
  }
  // Plain push — no -u (would silently set upstream), no --force.
  const output = await runGitOrThrow(projectPath, "push", ["push", "origin", branch], REMOTE_TIMEOUT_MS);
  return { output, ok: true };
}

export async function fetchAll(projectPath: string): Promise<FetchResult> {
  if (!(await hasAnyRemote(projectPath))) {
    throw new GitServiceError("git_failed", "no remote configured", 400);
  }
  const output = await runGitOrThrow(
    projectPath,
    "fetch",
    ["fetch", "--all", "--prune"],
    REMOTE_TIMEOUT_MS,
  );
  bustStatusCache(projectPath);
  return { output, ok: true };
}

// ---- Branch ops ----

export async function createBranch(
  projectPath: string,
  name: string,
  opts: { checkout?: boolean } = {},
): Promise<BranchOpResult> {
  const branch = assertBranchName(name);
  const args = opts.checkout ? ["checkout", "-b", branch] : ["branch", branch];
  await runGitOrThrow(projectPath, opts.checkout ? "checkout -b" : "branch create", args, LOCAL_TIMEOUT_MS);
  if (opts.checkout) bustStatusCache(projectPath);
  return { branch, action: opts.checkout ? "checked-out" : "created" };
}

export async function deleteBranch(
  projectPath: string,
  name: string,
  opts: { force?: boolean } = {},
): Promise<BranchOpResult> {
  const branch = assertBranchName(name);
  const cur = await currentBranch(projectPath);
  if (cur === branch) {
    throw new GitServiceError("git_failed", `cannot delete current branch: ${branch}`, 400);
  }
  const flag = opts.force ? "-D" : "-d";
  await runGitOrThrow(projectPath, `branch ${flag}`, ["branch", flag, branch], LOCAL_TIMEOUT_MS);
  return { branch, action: "deleted" };
}

export async function checkoutBranch(
  projectPath: string,
  name: string,
): Promise<BranchOpResult> {
  // Allow remote tracking like `origin/feature` -> create matching local branch.
  const trimmed = (name ?? "").trim();
  if (!trimmed || !VALID_BRANCH_RE.test(trimmed) || trimmed.includes("..")) {
    throw new GitServiceError("invalid_ref", `invalid branch name: ${name}`, 400);
  }
  await runGitOrThrow(projectPath, "checkout", ["checkout", trimmed], LOCAL_TIMEOUT_MS);
  bustStatusCache(projectPath);
  return { branch: trimmed, action: "checked-out" };
}

export async function mergeBranch(
  projectPath: string,
  name: string,
): Promise<MergeResult & { branch: string }> {
  const branch = assertBranchName(name);
  const cur = await currentBranch(projectPath);
  if (!cur) {
    throw new GitServiceError("git_failed", "cannot merge on detached HEAD", 400);
  }
  if (cur === branch) {
    throw new GitServiceError("git_failed", `already on ${branch}`, 400);
  }
  // --no-ff keeps a visible merge commit so users can see the integration in history.
  const output = await runGitOrThrow(
    projectPath,
    "merge",
    ["merge", "--no-ff", branch],
    LOCAL_TIMEOUT_MS,
  );
  bustStatusCache(projectPath);
  return { output, ok: true, branch };
}

// ---- Stash ops ----

export async function listStashes(projectPath: string): Promise<StashEntry[]> {
  const g = gitFor(projectPath);
  try {
    const raw = await g.raw([
      "stash",
      "list",
      "--date=iso-strict",
      "--format=%gd%x1f%gs%x1f%aI",
    ]);
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [ref, gs, date] = line.split("\x1f");
        // gs looks like: "WIP on main: 1234567 subject"
        const m = gs?.match(/^WIP on ([^:]+):\s*(.*)$/);
        return {
          ref: ref ?? "",
          branch: m ? m[1] : null,
          subject: m ? m[2] : (gs ?? ""),
          date: date ?? "",
        } satisfies StashEntry;
      });
  } catch {
    return [];
  }
}

export async function createStash(
  projectPath: string,
  message?: string,
): Promise<StashOpResult> {
  const args = ["stash", "push", "--include-untracked"];
  if (message && message.trim()) {
    args.push("-m", message.trim().slice(0, 200));
  }
  const output = await runGitOrThrow(projectPath, "stash push", args, LOCAL_TIMEOUT_MS);
  if (/no local changes to save/i.test(output)) {
    throw new GitServiceError("git_failed", "no local changes to stash", 400);
  }
  bustStatusCache(projectPath);
  return { output, ok: true };
}

export async function popStash(projectPath: string): Promise<StashOpResult> {
  const list = await listStashes(projectPath);
  if (list.length === 0) {
    throw new GitServiceError("git_failed", "stash is empty", 400);
  }
  const output = await runGitOrThrow(projectPath, "stash pop", ["stash", "pop"], LOCAL_TIMEOUT_MS);
  bustStatusCache(projectPath);
  return { output, ok: true };
}

// ---- Reset op ----

export async function resetSoftLastCommit(projectPath: string): Promise<ResetResult> {
  const g = gitFor(projectPath);
  let prev: string;
  try {
    prev = (await g.raw(["rev-parse", "HEAD"])).trim();
  } catch {
    throw new GitServiceError("git_failed", "no commits in repository", 400);
  }
  // Require at least one parent.
  try {
    await g.raw(["rev-parse", "--verify", "HEAD~1"]);
  } catch {
    throw new GitServiceError("git_failed", "cannot undo: HEAD has no parent (first commit)", 400);
  }
  await runGitOrThrow(projectPath, "reset --soft HEAD~1", ["reset", "--soft", "HEAD~1"], LOCAL_TIMEOUT_MS);
  bustStatusCache(projectPath);
  const head = (await g.raw(["rev-parse", "HEAD"])).trim();
  return { head, previousHead: prev };
}
