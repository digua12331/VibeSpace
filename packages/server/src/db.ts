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
        return isProjectLayout(layout)
          ? { id: p.id, name: p.name, path: p.path, createdAt: p.createdAt, layout }
          : { id: p.id, name: p.name, path: p.path, createdAt: p.createdAt };
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
  const tx = db.transaction((list: Project[]) => {
    db.prepare("DELETE FROM projects").run();
    const stmt = db.prepare(
      "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
    );
    for (const p of list) stmt.run(p.id, p.name, p.path, p.createdAt);
  });
  tx(projects);
}

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
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
      exit_code INTEGER
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
          exit_code INTEGER
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

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  layout?: ProjectLayout;
}

export interface Session {
  id: string;
  projectId: string;
  agent: Agent;
  status: SessionStatus;
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
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
}): Session {
  const db = getDb();
  const startedAt = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, project_id, agent, status, pid, started_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(input.id, input.projectId, input.agent, input.status, input.pid, startedAt);
  return {
    id: input.id,
    projectId: input.projectId,
    agent: input.agent,
    status: input.status,
    pid: input.pid,
    startedAt,
    endedAt: null,
    exitCode: null,
  };
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
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code FROM sessions ORDER BY started_at DESC",
    )
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

export function listSessionsByProject(projectId: string): Session[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code FROM sessions WHERE project_id = ? ORDER BY started_at DESC",
    )
    .all(projectId) as SessionRow[];
  return rows.map(rowToSession);
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, project_id, agent, status, pid, started_at, ended_at, exit_code FROM sessions WHERE id = ?",
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
