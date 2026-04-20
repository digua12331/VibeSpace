import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath, relative as relativePath, sep } from "node:path";
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

function toRepoRelative(projectPath: string, abs: string): string {
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

  const patch = await g.raw(args);
  const isBinary = /Binary files .* differ/.test(patch);
  return { path: relPosix, from, to, patch, isBinary };
}
