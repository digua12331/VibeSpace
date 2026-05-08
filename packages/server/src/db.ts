import Database from "better-sqlite3";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/server/data/aimon.db: src is at packages/server/src, so go up 1.
const SERVER_ROOT = resolve(__dirname, "..");
const DB_DIR = resolve(SERVER_ROOT, "data");
const DB_PATH = resolve(DB_DIR, "aimon.db");
const PROJECTS_JSON_PATH = resolve(DB_DIR, "projects.json");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  _db = db;
  return db;
}

export function getDbPath(): string {
  return DB_PATH;
}

export function getProjectsJsonPath(): string {
  return PROJECTS_JSON_PATH;
}

function isProjectLayout(v: unknown): v is ProjectLayout {
  if (!v || typeof v !== "object") return false;
  const l = v as Partial<ProjectLayout>;
  return (
    typeof l.cols === "number" &&
    typeof l.rowHeight === "number" &&
    typeof l.updatedAt === "number" &&
    Array.isArray(l.tiles)
  );
}

function isWorkflowMode(v: unknown): v is WorkflowMode {
  return v === "dev-docs" || v === "openspec";
}

function loadProjectsJson(): Project[] {
  if (!existsSync(PROJECTS_JSON_PATH)) return [];
  try {
    const raw = readFileSync(PROJECTS_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is Project =>
        !!p &&
        typeof (p as Project).id === "string" &&
        typeof (p as Project).name === "string" &&
        typeof (p as Project).path === "string" &&
        typeof (p as Project).createdAt === "number",
      )
      .map((p) => {
        const layout = (p as Project).layout;
        const wfRaw = (p as Project).workflowMode;
        const workflowMode: WorkflowMode | null = isWorkflowMode(wfRaw) ? wfRaw : null;
        const base: Project = { id: p.id, name: p.name, path: p.path, createdAt: p.createdAt };
        if (isProjectLayout(layout)) base.layout = layout;
        // 缺字段或非法值都序列化成 null（前端可据此判断"未设置"）
        base.workflowMode = workflowMode;
        return base;
      });
  } catch {
    return [];
  }
}

function saveProjectsJson(projects: Project[]): void {
  mkdirSync(DB_DIR, { recursive: true });
  const tmp = `${PROJECTS_JSON_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(projects, null, 2), "utf8");
  renameSync(tmp, PROJECTS_JSON_PATH);
}

function syncProjectsTable(db: Database.Database, projects: Project[]): void {
  // UPSERT instead of DELETE+INSERT: a blanket DELETE on projects triggers the
  // sessions ON DELETE CASCADE and wipes every session row even when the JSON
  // shadow is unchanged. tsx-watch reloads the module on every save, so dev
  // sessions used to vanish each time db.ts (or anything it imports) ticked.
  const tx = db.transaction((list: Project[]) => {
    const upsert = db.prepare(
      `INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         path = excluded.path,
         created_at = excluded.created_at`,
    );
    for (const p of list) upsert.run(p.id, p.name, p.path, p.createdAt);
    if (list.length === 0) {
      db.prepare("DELETE FROM projects").run();
      return;
    }
    const placeholders = list.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM projects WHERE id NOT IN (${placeholders})`,
    ).run(...list.map((p) => p.id));
  });
  tx(projects);
}

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  def: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      pid INTEGER,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      exit_code INTEGER,
      isolation TEXT NOT NULL DEFAULT 'shared',
      worktree_path TEXT,
      worktree_branch TEXT,
      task_name TEXT
    );
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, id);
  `);

  // Drop the legacy CHECK(agent IN ('claude','codex')) from pre-shell builds
  // so newer agent kinds (shell / cmd / pwsh) can be inserted. SQLite can't
  // modify a CHECK constraint in place — we copy the rows into a fresh table.
  const sessionsSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'")
    .get() as { sql?: string } | undefined;
  if (sessionsSchema?.sql && sessionsSchema.sql.includes("CHECK(agent IN")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        ALTER TABLE sessions RENAME TO sessions_legacy_checked;
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          agent TEXT NOT NULL,
          status TEXT NOT NULL,
          pid INTEGER,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          exit_code INTEGER,
          isolation TEXT NOT NULL DEFAULT 'shared',
          worktree_path TEXT,
          worktree_branch TEXT,
          task_name TEXT
        );
        INSERT INTO sessions (id, project_id, agent, status, pid, started_at, ended_at, exit_code)
          SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code
          FROM sessions_legacy_checked;
        DROP TABLE sessions_legacy_checked;
      `);
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  // For DBs created before harness-worktree隔离: add the three columns if
  // they're missing so old rows pick up the DEFAULT for isolation and NULL
  // for the path/branch fields.
  addColumnIfMissing(db, "sessions", "isolation", "TEXT NOT NULL DEFAULT 'shared'");
  addColumnIfMissing(db, "sessions", "worktree_path", "TEXT");
  addColumnIfMissing(db, "sessions", "worktree_branch", "TEXT");
  // Added in harness-task绑定与jobs面板.
  addColumnIfMissing(db, "sessions", "task_name", "TEXT");

  // projects.json is the authoritative store. The projects table is a shadow
  // kept in sync so session FKs and ON DELETE CASCADE still work.
  if (existsSync(PROJECTS_JSON_PATH)) {
    syncProjectsTable(db, loadProjectsJson());
  } else {
    const rows = db
      .prepare("SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC")
      .all() as ProjectRow[];
    saveProjectsJson(rows.map(rowToProject));
  }
}

// ---------- Types ----------

/**
 * Built-in shell agents are fixed; CLI-style agents come from CLI_CATALOG, so
 * Agent is intentionally widened to `string` and validated at the route layer
 * against `getCliEntry(id)` + the BUILTIN_SHELL_AGENTS set.
 */
export type Agent = string;
export const BUILTIN_SHELL_AGENTS = ["shell", "cmd", "pwsh"] as const;
export type SessionStatus =
  | "starting"
  | "running"
  | "working"
  | "waiting_input"
  | "idle"
  | "stopped"
  | "crashed";

export interface TileLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface ProjectLayout {
  cols: number;
  rowHeight: number;
  tiles: TileLayout[];
  updatedAt: number;
}

export type WorkflowMode = "dev-docs" | "openspec";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  layout?: ProjectLayout;
  /** 项目级"开发流程"模式；null 等同未设置（侧栏既不显示 Dev Docs 也不显示 OpenSpec tab）。
   *  存 projects.json 真源，不进 SQLite 影子表（与 layout 同模式，详 dev/active D11）。 */
  workflowMode?: WorkflowMode | null;
}

export type SessionIsolation = "shared" | "worktree";

export interface Session {
  id: string;
  projectId: string;
  agent: Agent;
  status: SessionStatus;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  isolation: SessionIsolation;
  worktreePath: string | null;
  worktreeBranch: string | null;
  /** Bound dev/active/<task> name; NULL when unbound. */
  task: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: number;
}

interface SessionRow {
  id: string;
  project_id: string;
  agent: Agent;
  status: SessionStatus;
  pid: number | null;
  started_at: number;
  ended_at: number | null;
  exit_code: number | null;
  isolation: SessionIsolation;
  worktree_path: string | null;
  worktree_branch: string | null;
  task_name: string | null;
}

function rowToProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, path: r.path, createdAt: r.created_at };
}
function rowToSession(r: SessionRow): Session {
  return {
    id: r.id,
    projectId: r.project_id,
    agent: r.agent,
    status: r.status,
    pid: r.pid,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    exitCode: r.exit_code,
    isolation: r.isolation ?? "shared",
    worktreePath: r.worktree_path,
    worktreeBranch: r.worktree_branch,
    task: r.task_name,
  };
}

// ---------- Project CRUD ----------
// projects.json is the source of truth; the SQLite projects table is kept in
// sync so the sessions FK / ON DELETE CASCADE continues to work.

export function createProject(input: { id: string; name: string; path: string }): Project {
  const db = getDb();
  const list = loadProjectsJson();
  if (list.some((p) => p.path === input.path)) {
    throw new Error("UNIQUE constraint failed: projects.path");
  }
  const createdAt = Date.now();
  const proj: Project = { id: input.id, name: input.name, path: input.path, createdAt };
  db.prepare(
    "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
  ).run(proj.id, proj.name, proj.path, proj.createdAt);
  saveProjectsJson([proj, ...list]);
  return proj;
}

export function listProjects(): Project[] {
  return loadProjectsJson()
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getProject(id: string): Project | null {
  return loadProjectsJson().find((p) => p.id === id) ?? null;
}

export function updateProjectLayout(id: string, layout: ProjectLayout): boolean {
  const list = loadProjectsJson();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  const next = list.slice();
  next[idx] = { ...next[idx], layout };
  saveProjectsJson(next);
  return true;
}

/** 把 workflowMode 写进 projects.json 真源；null 表示清空（侧栏既不显 Dev Docs 也不显 OpenSpec）。 */
export function updateProjectWorkflowMode(
  id: string,
  mode: WorkflowMode | null,
): boolean {
  const list = loadProjectsJson();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  const next = list.slice();
  next[idx] = { ...next[idx], workflowMode: mode };
  saveProjectsJson(next);
  return true;
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const list = loadProjectsJson();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  saveProjectsJson(next);
  return true;
}

// ---------- Session CRUD ----------

export function createSession(input: {
  id: string;
  projectId: string;
  agent: Agent;
  status: SessionStatus;
  pid: number | null;
  isolation?: SessionIsolation;
  task?: string | null;
}): Session {
  const db = getDb();
  const startedAt = Date.now();
  const isolation: SessionIsolation = input.isolation ?? "shared";
  const taskName = input.task ?? null;
  db.prepare(
    "INSERT INTO sessions (id, project_id, agent, status, pid, started_at, isolation, task_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    input.id,
    input.projectId,
    input.agent,
    input.status,
    input.pid,
    startedAt,
    isolation,
    taskName,
  );
  return {
    id: input.id,
    projectId: input.projectId,
    agent: input.agent,
    status: input.status,
    pid: input.pid,
    startedAt,
    endedAt: null,
    exitCode: null,
    isolation,
    worktreePath: null,
    worktreeBranch: null,
    task: taskName,
  };
}

export function setSessionWorktree(
  id: string,
  worktreePath: string | null,
  worktreeBranch: string | null,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET worktree_path = ?, worktree_branch = ? WHERE id = ?",
  ).run(worktreePath, worktreeBranch, id);
}

export function setSessionTask(id: string, task: string | null): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET task_name = ? WHERE id = ?").run(task, id);
}

/**
 * Find an alive session (ended_at IS NULL) currently bound to `task` within
 * `projectId`, if any. Used for the preempt detection in PATCH /:id/task.
 */
export function findSessionBoundToTask(
  projectId: string,
  task: string,
): Session | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code, isolation, worktree_path, worktree_branch, task_name FROM sessions WHERE project_id = ? AND task_name = ? AND ended_at IS NULL LIMIT 1",
    )
    .get(projectId, task) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function updateSessionStatus(id: string, status: SessionStatus): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, id);
}

export function updateSessionPid(id: string, pid: number | null): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET pid = ? WHERE id = ?").run(pid, id);
}

export function endSession(
  id: string,
  status: SessionStatus,
  exitCode: number | null,
): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?",
  ).run(status, Date.now(), exitCode, id);
}

export function listSessions(): Session[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code, isolation, worktree_path, worktree_branch, task_name FROM sessions ORDER BY started_at DESC",
    )
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

export function listSessionsByProject(projectId: string): Session[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code, isolation, worktree_path, worktree_branch, task_name FROM sessions WHERE project_id = ? ORDER BY started_at DESC",
    )
    .all(projectId) as SessionRow[];
  return rows.map(rowToSession);
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code, isolation, worktree_path, worktree_branch, task_name FROM sessions WHERE id = ?",
    )
    .get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function appendEvent(input: {
  sessionId: string;
  kind: string;
  payload: unknown;
}): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO session_events (session_id, ts, kind, payload) VALUES (?, ?, ?, ?)",
  ).run(input.sessionId, Date.now(), input.kind, JSON.stringify(input.payload ?? null));
}

