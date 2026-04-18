import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_VERSION = "1";
const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
] as const;

type HookEntry = { type: string; command: string };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type SettingsShape = {
  hooks?: Record<string, HookGroup[]>;
  _aimon_hooks_version?: string;
  [k: string]: unknown;
};

function findHookScript(): string {
  // src is at packages/server/src; hook script at packages/hook-script/aimon-hook.mjs
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Up from src/ → server/, then up to packages/
  const pkgRoot = resolve(__dirname, "..", "..");
  const candidate = resolve(pkgRoot, "hook-script", "aimon-hook.mjs");
  return candidate;
}

function isAimonEntry(e: HookEntry): boolean {
  return (
    typeof e?.command === "string" &&
    e.command.includes("aimon-hook.mjs")
  );
}

function makeEntry(scriptPath: string, event: string): HookGroup {
  // Use forward slashes so the JSON looks clean on Windows too.
  const norm = scriptPath.replace(/\\/g, "/");
  return {
    hooks: [
      {
        type: "command",
        command: `node "${norm}" ${event}`,
      },
    ],
  };
}

export interface InstallResult {
  status: "installed" | "updated" | "already-installed" | "skipped" | "failed";
  settingsPath: string;
  hookScript: string;
  changed: string[];
  error?: string;
}

export function installClaudeHooks(): InstallResult {
  const settingsPath = resolve(homedir(), ".claude", "settings.json");
  const hookScript = findHookScript();

  if (!existsSync(hookScript)) {
    return {
      status: "failed",
      settingsPath,
      hookScript,
      changed: [],
      error: "hook script not found at " + hookScript,
    };
  }

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
  } catch { /* ignore */ }

  let raw: SettingsShape = {};
  let existed = false;
  if (existsSync(settingsPath)) {
    existed = true;
    try {
      const txt = readFileSync(settingsPath, "utf8");
      raw = txt.trim() ? (JSON.parse(txt) as SettingsShape) : {};
    } catch (e) {
      return {
        status: "failed",
        settingsPath,
        hookScript,
        changed: [],
        error: "could not parse existing settings.json: " + (e as Error).message,
      };
    }

    // One-shot backup before we touch anything.
    const backup = settingsPath + ".aimon-backup";
    if (!existsSync(backup)) {
      try { copyFileSync(settingsPath, backup); } catch { /* non-fatal */ }
    }
  }

  if (!raw.hooks || typeof raw.hooks !== "object") raw.hooks = {};
  const hooks = raw.hooks;

  const changed: string[] = [];
  for (const ev of EVENTS) {
    const list = Array.isArray(hooks[ev]) ? hooks[ev]! : [];
    const existingAimonIdx = list.findIndex(
      (g) => Array.isArray(g?.hooks) && g.hooks.some(isAimonEntry),
    );
    const wanted = makeEntry(hookScript, ev);
    if (existingAimonIdx === -1) {
      list.push(wanted);
      changed.push(ev);
    } else {
      // Already present — refresh the command (path may differ between machines / repo moves).
      const cur = list[existingAimonIdx];
      const curCmd = cur?.hooks?.[0]?.command;
      const newCmd = wanted.hooks[0].command;
      if (curCmd !== newCmd) {
        list[existingAimonIdx] = wanted;
        changed.push(ev + "(refreshed)");
      }
    }
    hooks[ev] = list;
  }

  const versionChanged = raw._aimon_hooks_version !== HOOK_VERSION;
  raw._aimon_hooks_version = HOOK_VERSION;

  if (changed.length === 0 && !versionChanged && existed) {
    return {
      status: "already-installed",
      settingsPath,
      hookScript,
      changed: [],
    };
  }

  // Atomic write: tmp → rename.
  const tmp = settingsPath + ".aimon-tmp";
  try {
    writeFileSync(tmp, JSON.stringify(raw, null, 2) + "\n", "utf8");
    renameSync(tmp, settingsPath);
  } catch (e) {
    return {
      status: "failed",
      settingsPath,
      hookScript,
      changed,
      error: (e as Error).message,
    };
  }

  return {
    status: existed ? "updated" : "installed",
    settingsPath,
    hookScript,
    changed,
  };
}
