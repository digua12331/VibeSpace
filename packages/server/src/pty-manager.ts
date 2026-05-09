import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Agent } from "./db.js";
import { getCliEntry } from "./cli-catalog.js";

const require = createRequire(import.meta.url);

type PtyProcess = {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number | null }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
};
type PtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    opts: Record<string, unknown>,
  ) => PtyProcess;
};

let _pty: PtyModule | null = null;
function loadPty(): PtyModule {
  if (_pty) return _pty;
  _pty = require("@homebridge/node-pty-prebuilt-multiarch") as PtyModule;
  return _pty;
}

// Fire-and-forget preload：把 native binding 的首次加载（~300ms）从"用户首次
// spawn"挪到"服务进程刚启动后台"，让首个 spawn 也走 _pty 缓存命中路径。
// `loadPty()` 是同步 require，setImmediate 把它推到 event loop 下一拍，避免
// 阻塞模块解析；try/catch 兜底防止 ARM/Alpine/不同 Node 版本下 native binding
// 缺失变成 unhandledRejection。失败不影响主流程——真正 spawn 时会再 require
// 一次并给出真实错误。
setImmediate(() => {
  try {
    loadPty();
  } catch {
    /* noop — first real spawn will surface the binding error */
  }
});

const isWin = process.platform === "win32";
const MAX_BUFFER_BYTES = 200 * 1024;

export interface SpawnOpts {
  sessionId: string;
  agent: Agent;
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface SpawnResult {
  pid: number;
}

interface SessionEntry {
  proc: PtyProcess;
  buffer: string;
  bufferBytes: number;
  killed: boolean;
}

export function findExecutable(name: string): string | null {
  const exts = isWin ? [".cmd", ".exe", ".bat", ""] : [""];
  const sep = isWin ? ";" : ":";
  const dirs = (process.env.PATH || "").split(sep);
  for (const d of dirs) {
    if (!d) continue;
    for (const ext of exts) {
      const full = join(d, name + ext);
      try {
        if (existsSync(full)) return full;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

interface SpawnSpec {
  file: string;
  args: string[];
}

function resolveAgentSpec(agent: Agent): SpawnSpec {
  // Built-in shells stay hard-coded so they always resolve even when the
  // catalog hasn't been loaded yet.
  if (agent === "cmd") {
    if (isWin) {
      const cmd = process.env.ComSpec || "cmd.exe";
      return { file: cmd, args: [] };
    }
    const sh = findExecutable("sh");
    if (!sh) throw new Error("no shell found: cmd requested but not on Windows and sh missing");
    return { file: sh, args: [] };
  }
  if (agent === "pwsh") {
    const pwsh = findExecutable("pwsh");
    if (pwsh) return { file: pwsh, args: ["-NoLogo"] };
    if (isWin) {
      const ps = findExecutable("powershell");
      if (ps) return { file: ps, args: ["-NoLogo"] };
    }
    throw new Error("PowerShell executable not found on PATH (pwsh / powershell)");
  }
  if (agent === "shell") {
    if (isWin) {
      const cmd = process.env.ComSpec || "cmd.exe";
      return { file: cmd, args: [] };
    }
    const sh = process.env.SHELL || findExecutable("bash") || findExecutable("sh");
    if (!sh) throw new Error("no default shell found");
    return { file: sh, args: [] };
  }

  // Anything else must come from the CLI catalog (claude / codex / gemini /
  // opencode / qoder / kilo / future entries). The catalog tells us which
  // executable names to probe and what spawn args to use.
  const entry = getCliEntry(agent);
  if (!entry) throw new Error(`unknown agent: ${agent}`);
  for (const name of entry.bin) {
    const found = findExecutable(name);
    if (found) return { file: found, args: entry.spawnArgs ?? [] };
  }
  throw new Error(
    `agent executable not found on PATH: ${agent} (looked for ${entry.bin.join(", ")})`,
  );
}

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8787";

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, SessionEntry>();

  /**
   * Events:
   *   'output' (sessionId, data: string)
   *   'exit'   (sessionId, code: number, signal: number | null)
   */

  spawn(opts: SpawnOpts): SpawnResult {
    const { sessionId, agent, cwd } = opts;
    if (this.sessions.has(sessionId)) {
      throw new Error(`session already running: ${sessionId}`);
    }
    const spec = resolveAgentSpec(agent);
    const pty = loadPty();

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(opts.env ?? {}),
      AIMON_SESSION_ID: sessionId,
      AIMON_BACKEND: process.env.AIMON_BACKEND_URL || DEFAULT_BACKEND_URL,
      LANG: process.env.LANG || "en_US.UTF-8",
    };

    const ptyOpts: Record<string, unknown> = {
      name: "xterm-256color",
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      cwd,
      env,
    };
    if (isWin) {
      ptyOpts.useConpty = true;
    } else {
      ptyOpts.encoding = "utf8";
    }

    const proc = pty.spawn(spec.file, spec.args, ptyOpts);
    const entry: SessionEntry = {
      proc,
      buffer: "",
      bufferBytes: 0,
      killed: false,
    };
    this.sessions.set(sessionId, entry);

    proc.onData((data) => {
      entry.buffer += data;
      entry.bufferBytes += Buffer.byteLength(data, "utf8");
      if (entry.bufferBytes > MAX_BUFFER_BYTES) {
        const overflow = entry.bufferBytes - MAX_BUFFER_BYTES;
        let cutChars = 0;
        let dropped = 0;
        while (cutChars < entry.buffer.length && dropped < overflow) {
          const ch = entry.buffer[cutChars];
          dropped += Buffer.byteLength(ch, "utf8");
          cutChars += 1;
        }
        entry.buffer = entry.buffer.slice(cutChars);
        entry.bufferBytes -= dropped;
      }
      this.emit("output", sessionId, data);
    });

    proc.onExit(({ exitCode, signal }) => {
      const wasKilled = entry.killed;
      this.sessions.delete(sessionId);
      this.emit("exit", sessionId, exitCode, signal ?? null, wasKilled);
    });

    return { pid: proc.pid };
  }

  write(sessionId: string, data: string): boolean {
    const e = this.sessions.get(sessionId);
    if (!e) return false;
    try {
      e.proc.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const e = this.sessions.get(sessionId);
    if (!e) return false;
    try {
      e.proc.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /** Optimistically kill: SIGTERM, then SIGKILL after 3s if still alive. */
  kill(sessionId: string, signal?: string): boolean {
    const e = this.sessions.get(sessionId);
    if (!e) return false;
    if (e.killed) return true;
    e.killed = true;
    try {
      e.proc.kill(signal);
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (this.sessions.has(sessionId)) {
        try {
          e.proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }, 3000).unref();
    return true;
  }

  getBuffer(sessionId: string): string {
    const e = this.sessions.get(sessionId);
    return e ? e.buffer : "";
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Alias kept for callers that prefer the old name. */
  isAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  listAlive(): string[] {
    return [...this.sessions.keys()];
  }

  getPid(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.proc.pid ?? null;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }
}

export const ptyManager = new PtyManager();
