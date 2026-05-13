import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function claudeDir(): string {
  return join(homedir(), ".claude");
}

function settingsPath(): string {
  return join(claudeDir(), "settings.json");
}

export interface ClaudeSettingsRead {
  /** Full settings object as parsed from disk; `{}` if file missing or unparseable. */
  settings: Record<string, unknown>;
  exists: boolean;
  parseError?: string;
}

export interface ClaudeSettingsPatch {
  /**
   * `'off'` writes the entry; `null` deletes the key. Anything else throws
   * (kept defensive — the route already zod-checks values, this is a second
   * line of defense).
   */
  skillOverrides?: Record<string, "off" | null>;
  /** Boolean toggles. Plugin entries are deleted only via Claude Code's own uninstall flow, not by this patch. */
  enabledPlugins?: Record<string, boolean>;
}

export function getClaudeSettingsPath(): string {
  return settingsPath();
}

export function readClaudeSettings(): ClaudeSettingsRead {
  const path = settingsPath();
  if (!existsSync(path)) {
    return { settings: {}, exists: false };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        settings: {},
        exists: true,
        parseError: "settings.json 顶层不是对象",
      };
    }
    return { settings: parsed as Record<string, unknown>, exists: true };
  } catch (err) {
    return {
      settings: {},
      exists: true,
      parseError: (err as Error).message,
    };
  }
}

/**
 * Atomic patch:
 *  1. Re-read from disk (Claude Code itself may have written between our GET and PUT)
 *  2. Shallow-merge `skillOverrides` and `enabledPlugins`; preserve every other top-level key
 *  3. JSON.stringify with 2-space indent (matches existing file style)
 *  4. Write to `settings.json.tmp` in the **same directory** (Windows: cross-volume rename fails)
 *  5. fs.renameSync onto the real path
 *
 * Throws on JSON parse error from disk (don't silently overwrite a corrupted file).
 */
export function patchClaudeSettings(patch: ClaudeSettingsPatch): ClaudeSettingsRead {
  const path = settingsPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const fresh = readClaudeSettings();
  if (fresh.parseError) {
    throw new Error(`无法解析现有 settings.json：${fresh.parseError}（拒绝覆盖损坏的配置文件）`);
  }
  const next: Record<string, unknown> = { ...fresh.settings };

  if (patch.skillOverrides) {
    const cur = (next.skillOverrides && typeof next.skillOverrides === "object"
      ? { ...(next.skillOverrides as Record<string, unknown>) }
      : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch.skillOverrides)) {
      if (v === null) {
        delete cur[k];
      } else if (v === "off") {
        cur[k] = "off";
      } else {
        throw new Error(`skillOverrides[${k}] 取值非法：仅支持 'off' 或 null`);
      }
    }
    if (Object.keys(cur).length === 0) {
      delete next.skillOverrides;
    } else {
      next.skillOverrides = cur;
    }
  }

  if (patch.enabledPlugins) {
    const cur = (next.enabledPlugins && typeof next.enabledPlugins === "object"
      ? { ...(next.enabledPlugins as Record<string, unknown>) }
      : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch.enabledPlugins)) {
      if (typeof v !== "boolean") {
        throw new Error(`enabledPlugins[${k}] 取值非法：必须是 boolean`);
      }
      cur[k] = v;
    }
    next.enabledPlugins = cur;
  }

  const tmp = join(dir, "settings.json.tmp");
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, path);
  return { settings: next, exists: true };
}
