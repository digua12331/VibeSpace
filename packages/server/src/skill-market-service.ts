/**
 * Skill market service —— 二期：从 GitHub topic:skill / skills.sh 搜索并 git
 * clone 到本地库；与一期 skill-catalog-service 协作（一期负责"装到项目"）。
 *
 * 安全三件套（plan / context 强约束）：
 *  1. repoUrl 白名单 regex，匹配后只用 owner/repo 重组 cloneUrl。
 *  2. clone 后递归累计大小，>50MB 或 >5000 文件 → 拒绝。
 *  3. cpSync 走 dereference:true，防仓库里塞 symlink 越狱。
 *
 * subprocess 走 async spawn + Promise，60s 硬超时；shell:false 不可命令注入。
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { parseSkillManifest } from "./skill-catalog-service.js";

// ---------------------------------------------------------------------------
// Types

export type SkillSource = "github" | "skills-sh";

export interface MarketSkill {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  author: string;
  stars: number;
  repoUrl: string;
  updatedAt?: string;
}

export interface GitHubSearchOk {
  items: MarketSkill[];
  total: number;
  rateLimitRemaining: number | null;
}

export interface SkillsShSearchOk {
  items: MarketSkill[];
  total: number;
}

export interface CombinedSearchResult {
  source: "github" | "skills-sh" | "all";
  github: GitHubSearchOk | null;
  skillsSh: SkillsShSearchOk | null;
  cached: boolean;
}

export interface LibrarySkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  source: "official" | "custom";
}

export interface LibraryResult {
  path: string;
  official: LibrarySkillEntry[];
  custom: LibrarySkillEntry[];
}

export interface DownloadResult {
  success: true;
  path: string;
  skillName: string;
  sizeBytes: number;
  fileCount: number;
}

export class SkillMarketError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Config

const CONFIG_DIR = join(homedir(), ".vibespace");
const CONFIG_FILE = join(CONFIG_DIR, "skill-market.json");
const DEFAULT_LIB = join(homedir(), "SkillManager");

interface Config {
  localLibraryPath: string;
}

function readConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<Config>;
      if (parsed && typeof parsed.localLibraryPath === "string" && parsed.localLibraryPath) {
        return { localLibraryPath: parsed.localLibraryPath };
      }
    }
  } catch {
    // fall through
  }
  return { localLibraryPath: DEFAULT_LIB };
}

function writeConfig(cfg: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

export function getLocalLibraryPath(): string {
  return readConfig().localLibraryPath;
}

export function setLocalLibraryPath(newPath: string, migrate = false): {
  path: string;
  migrated: { from: string; to: string; fileCount: number } | null;
} {
  if (!newPath || typeof newPath !== "string") {
    throw new SkillMarketError(
      "Invalid path",
      "invalid_path",
      400,
    );
  }
  // ensure target exists or can be created; reject if it already exists as a file.
  if (existsSync(newPath)) {
    const st = statSync(newPath);
    if (!st.isDirectory()) {
      throw new SkillMarketError(
        "Target path is not a directory",
        "path_not_directory",
        400,
      );
    }
  } else {
    try {
      mkdirSync(newPath, { recursive: true });
    } catch (err) {
      throw new SkillMarketError(
        `Cannot create library path: ${(err as Error).message}`,
        "path_unwritable",
        400,
      );
    }
  }
  const oldPath = readConfig().localLibraryPath;
  let migrated: { from: string; to: string; fileCount: number } | null = null;
  if (migrate && oldPath !== newPath && existsSync(oldPath)) {
    let count = 0;
    for (const sub of ["official", "custom"]) {
      const src = join(oldPath, sub);
      if (!existsSync(src)) continue;
      const dst = join(newPath, sub);
      cpSync(src, dst, { recursive: true, dereference: true, force: false });
      count += countFilesShallow(dst);
    }
    migrated = { from: oldPath, to: newPath, fileCount: count };
  }
  writeConfig({ localLibraryPath: newPath });
  return { path: newPath, migrated };
}

function countFilesShallow(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) n += countFilesShallow(full);
    else n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Local library scanning

function scanLibraryDir(dir: string, source: "official" | "custom"): LibrarySkillEntry[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: LibrarySkillEntry[] = [];
  for (const id of names) {
    const full = join(dir, id);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
    if (!existsSync(join(full, "SKILL.md"))) continue;
    const { name, description } = parseSkillManifest(full);
    out.push({ id, name, description, path: full, source });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function scanLocalLibrary(): LibraryResult {
  const path = getLocalLibraryPath();
  return {
    path,
    official: scanLibraryDir(join(path, "official"), "official"),
    custom: scanLibraryDir(join(path, "custom"), "custom"),
  };
}

// ---------------------------------------------------------------------------
// Library deletion (rm -rf one folder under <lib>/<source>/<name>)

export function deleteLibrarySkill(args: {
  name: string;
  source: "official" | "custom";
}): { deleted: true; name: string; source: "official" | "custom"; path: string } {
  const { name, source } = args;
  if (
    !name ||
    typeof name !== "string" ||
    name.length > 200 ||
    name.includes("..") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes(sep)
  ) {
    throw new SkillMarketError("Invalid skill name", "invalid_skill_name", 400);
  }
  if (source !== "official" && source !== "custom") {
    throw new SkillMarketError("Invalid source", "invalid_source", 400);
  }
  const libPath = getLocalLibraryPath();
  const sourceDir = join(libPath, source);
  const target = join(sourceDir, name);
  const sourceResolved = resolve(sourceDir);
  const targetResolved = resolve(target);
  if (!targetResolved.startsWith(sourceResolved + sep)) {
    throw new SkillMarketError(
      "Refusing to delete outside library",
      "path_escape",
      400,
    );
  }
  if (!existsSync(target)) {
    throw new SkillMarketError(
      `Skill not found in library: ${name}`,
      "not_found",
      404,
    );
  }
  rmSync(target, { recursive: true, force: true });
  return { deleted: true, name, source, path: target };
}

// ---------------------------------------------------------------------------
// Search — GitHub (cached) + skills.sh

const GH_CACHE = new Map<string, { ts: number; value: GitHubSearchOk }>();
const GH_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => {
    clearTimeout(timer);
  });
}

export async function searchGitHub(args: {
  q: string;
  page: number;
  limit: number;
}): Promise<{ result: GitHubSearchOk; cached: boolean }> {
  const { q, page, limit } = args;
  const cacheKey = `${q}|${page}|${limit}`;
  const cached = GH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < GH_TTL_MS) {
    return { result: cached.value, cached: true };
  }
  const query = q.trim() ? `${q} topic:skill in:name,description` : `topic:skill`;
  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
    `&sort=stars&order=desc&page=${page}&per_page=${Math.min(limit, 100)}`;
  const headers: Record<string, string> = {
    "User-Agent": "VibeSpace-SkillMarket",
    Accept: "application/vnd.github.v3+json",
  };
  const token = process.env.VIBESPACE_GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) {
    throw new SkillMarketError(
      `GitHub search failed: ${res.status} ${res.statusText}`,
      "github_search_failed",
      res.status === 403 ? 429 : 502,
    );
  }
  const remainingHeader = res.headers.get("x-ratelimit-remaining");
  const data = (await res.json()) as {
    total_count?: number;
    items?: Array<{
      id: number;
      name: string;
      description: string | null;
      stargazers_count: number;
      owner: { login: string };
      html_url: string;
      updated_at: string;
    }>;
  };
  const items: MarketSkill[] = (data.items ?? []).map((repo) => ({
    id: String(repo.id),
    name: repo.name,
    description: repo.description ?? "",
    source: "github",
    author: repo.owner?.login ?? "",
    stars: repo.stargazers_count ?? 0,
    repoUrl: repo.html_url,
    updatedAt: repo.updated_at,
  }));
  const result: GitHubSearchOk = {
    items,
    total: data.total_count ?? items.length,
    rateLimitRemaining: remainingHeader != null ? Number(remainingHeader) : null,
  };
  GH_CACHE.set(cacheKey, { ts: Date.now(), value: result });
  return { result, cached: false };
}

export async function searchSkillsSh(args: {
  q: string;
  limit: number;
}): Promise<SkillsShSearchOk> {
  const { q, limit } = args;
  try {
    const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=${Math.min(limit, 100)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { items: [], total: 0 };
    const data = (await res.json()) as {
      skills?: Array<{
        id?: string | number;
        name?: string;
        description?: string;
        source?: string;
        installs?: number;
      }>;
    };
    const items: MarketSkill[] = (data.skills ?? [])
      .filter((s) => s && s.name)
      .map((s) => ({
        id: String(s.id ?? s.name ?? ""),
        name: String(s.name ?? ""),
        description: String(s.description ?? ""),
        source: "skills-sh",
        author: String(s.source ?? ""),
        stars: 0,
        repoUrl: s.source ? `https://github.com/${s.source}` : "",
      }));
    return { items, total: items.length };
  } catch {
    return { items: [], total: 0 };
  }
}

export async function searchSkills(args: {
  q: string;
  source: "github" | "skills-sh" | "all";
  page: number;
  limit: number;
}): Promise<CombinedSearchResult> {
  const { q, source, page, limit } = args;
  let github: GitHubSearchOk | null = null;
  let skillsSh: SkillsShSearchOk | null = null;
  let cached = false;
  if (source === "github" || source === "all") {
    try {
      const { result, cached: c } = await searchGitHub({ q, page, limit });
      github = result;
      cached = c;
    } catch (err) {
      if (err instanceof SkillMarketError) {
        // Surface rate-limit / 502 to caller; non-rate-limit failures still surface.
        throw err;
      }
      github = { items: [], total: 0, rateLimitRemaining: null };
    }
  }
  if (source === "skills-sh" || source === "all") {
    skillsSh = await searchSkillsSh({ q, limit });
  }
  return { source, github, skillsSh, cached };
}

// ---------------------------------------------------------------------------
// Download

const REPO_URL_RE =
  /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

const SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB
const FILE_LIMIT = 5000;
const GIT_TIMEOUT_MS = 60_000;

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string; cloneUrl: string } {
  if (typeof repoUrl !== "string" || repoUrl.length > 200 || repoUrl.length === 0) {
    throw new SkillMarketError("Invalid repoUrl", "invalid_repo_url", 400);
  }
  const m = REPO_URL_RE.exec(repoUrl.trim());
  if (!m) {
    throw new SkillMarketError("Invalid repoUrl", "invalid_repo_url", 400);
  }
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) {
    throw new SkillMarketError("Invalid repoUrl", "invalid_repo_url", 400);
  }
  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

let _gitChecked = false;
let _gitAvailable = false;

async function checkGitAvailable(): Promise<boolean> {
  if (_gitChecked) return _gitAvailable;
  _gitChecked = true;
  try {
    _gitAvailable = await new Promise<boolean>((res) => {
      const child = spawn("git", ["--version"], { stdio: "ignore", shell: false });
      child.on("error", () => res(false));
      child.on("close", (code) => res(code === 0));
    });
  } catch {
    _gitAvailable = false;
  }
  return _gitAvailable;
}

function execGit(args: string[], opts: { timeoutMs: number }): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let stderr = "";
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new SkillMarketError("git clone timed out", "git_timeout", 504));
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

function findSkillRoot(tmpDir: string, skillName: string): string | null {
  // Strategy: prefer exact subdir name match; fallback to first SKILL.md
  // anywhere in the tree (skipping hidden dirs).
  function walk(dir: string, prefer: string | null): string | null {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    // priority pass: exact match
    if (prefer) {
      for (const e of entries) {
        if (e.isDirectory() && e.name === prefer && existsSync(join(dir, e.name, "SKILL.md"))) {
          return join(dir, e.name);
        }
      }
    }
    // shallow pass: any direct child with SKILL.md
    if (existsSync(join(dir, "SKILL.md"))) return dir;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue;
      if (existsSync(join(dir, e.name, "SKILL.md"))) return join(dir, e.name);
    }
    // depth pass
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue;
      const r = walk(join(dir, e.name), null);
      if (r) return r;
    }
    return null;
  }
  return walk(tmpDir, skillName);
}

function measureDir(dir: string): { sizeBytes: number; fileCount: number } {
  let sizeBytes = 0;
  let fileCount = 0;
  function walk(p: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        fileCount += 1;
        try {
          sizeBytes += statSync(full).size;
        } catch {
          // ignore
        }
        if (fileCount > FILE_LIMIT || sizeBytes > SIZE_LIMIT_BYTES) {
          // Short-circuit: throw to bail out of the whole walk.
          throw new SkillMarketError(
            `Skill exceeds limits (>${FILE_LIMIT} files or >50MB)`,
            "too_large",
            413,
          );
        }
      }
    }
  }
  walk(dir);
  return { sizeBytes, fileCount };
}

let _downloading = false;

export async function downloadSkill(args: {
  repoUrl: string;
  skillName: string;
}): Promise<DownloadResult> {
  const { skillName } = args;
  if (
    !skillName ||
    skillName.length > 200 ||
    skillName.includes("..") ||
    skillName.includes(sep) ||
    skillName.includes("/") ||
    skillName.includes("\\")
  ) {
    throw new SkillMarketError("Invalid skillName", "invalid_skill_name", 400);
  }
  const { cloneUrl } = parseRepoUrl(args.repoUrl);

  if (_downloading) {
    throw new SkillMarketError(
      "Another download is in progress",
      "download_in_progress",
      429,
    );
  }
  if (!(await checkGitAvailable())) {
    throw new SkillMarketError(
      "git is not installed or not on PATH",
      "git_not_installed",
      503,
    );
  }

  const libPath = getLocalLibraryPath();
  const officialDir = join(libPath, "official");
  mkdirSync(officialDir, { recursive: true });
  const destDir = join(officialDir, skillName);
  if (existsSync(destDir)) {
    throw new SkillMarketError(
      `Skill already in local library: ${skillName}`,
      "already_exists",
      409,
    );
  }

  const tmpDir = join(tmpdir(), `vibespace-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  _downloading = true;
  try {
    mkdirSync(tmpDir, { recursive: true });
    const { code, stderr } = await execGit(
      ["clone", "--depth", "1", "--single-branch", cloneUrl, tmpDir],
      { timeoutMs: GIT_TIMEOUT_MS },
    );
    if (code !== 0) {
      throw new SkillMarketError(
        `git clone failed (exit ${code}): ${stderr.slice(0, 200)}`,
        "git_clone_failed",
        502,
      );
    }
    const skillRoot = findSkillRoot(tmpDir, skillName);
    if (!skillRoot) {
      throw new SkillMarketError(
        "No SKILL.md found in cloned repository",
        "no_skill_md",
        400,
      );
    }
    const measured = measureDir(skillRoot);
    cpSync(skillRoot, destDir, {
      recursive: true,
      dereference: true,
      force: false,
    });
    const finalResolved = resolve(destDir);
    const officialResolved = resolve(officialDir);
    if (!finalResolved.startsWith(officialResolved + sep)) {
      // Belt-and-suspenders; should be impossible after skillName validation.
      rmSync(destDir, { recursive: true, force: true });
      throw new SkillMarketError(
        "Refusing to write outside library",
        "path_escape",
        400,
      );
    }
    return {
      success: true,
      path: destDir,
      skillName,
      sizeBytes: measured.sizeBytes,
      fileCount: measured.fileCount,
    };
  } catch (err) {
    // best-effort: clean any partial dest written (cpSync atomicity is loose)
    try {
      if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw err;
  } finally {
    _downloading = false;
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
