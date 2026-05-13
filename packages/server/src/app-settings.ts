import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(SERVER_ROOT, "data");
const SETTINGS_PATH = resolve(DATA_DIR, "app-settings.json");

export interface AppSettings {
  /**
   * Days to keep pasted images under each project's `.vibespace/pasted-images/`.
   * `0` means "do not prune"; the prune routine early-returns. Bounded to
   * [0, 365] at the REST boundary.
   */
  pasteImageRetentionDays: number;
}

const DEFAULTS: AppSettings = {
  pasteImageRetentionDays: 1,
};

function clampRetentionDays(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.pasteImageRetentionDays;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > 365) return 365;
  return v;
}

function readFromDisk(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };
    const v = (parsed as Record<string, unknown>).pasteImageRetentionDays;
    return {
      pasteImageRetentionDays: clampRetentionDays(v),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getAppSettings(): AppSettings {
  return readFromDisk();
}

export function getAppSettingsPath(): string {
  return SETTINGS_PATH;
}

/**
 * Atomic write: serialize to a temp file in the same directory and rename
 * over the real path. Avoids a half-written JSON if the process is killed
 * mid-write. The caller gets the merged final state back.
 */
export function setAppSettings(patch: Partial<AppSettings>): AppSettings {
  mkdirSync(DATA_DIR, { recursive: true });
  const current = readFromDisk();
  const next: AppSettings = {
    pasteImageRetentionDays: clampRetentionDays(
      patch.pasteImageRetentionDays ?? current.pasteImageRetentionDays,
    ),
  };
  const tmp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, SETTINGS_PATH);
  return next;
}
