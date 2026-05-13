import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(SERVER_ROOT, "data");
const SETTINGS_PATH = resolve(DATA_DIR, "app-settings.json");

export interface HibernationSettings {
  /** Master switch — when false the sweeper exits early every tick. */
  enabled: boolean;
  /** Minutes of inactivity before a session gets killed and marked hibernated. Bounded to [5, 180]. */
  idleMinutes: number;
  /** When false, builtin shell agents (shell/cmd/pwsh) are exempt — they're cheap and losing their cwd history is annoying. */
  includeShells: boolean;
}

export interface AppSettings {
  /**
   * Days to keep pasted images under each project's `.vibespace/pasted-images/`.
   * `0` means "do not prune"; the prune routine early-returns. Bounded to
   * [0, 365] at the REST boundary.
   */
  pasteImageRetentionDays: number;
  hibernation: HibernationSettings;
}

const DEFAULTS: AppSettings = {
  pasteImageRetentionDays: 1,
  hibernation: {
    enabled: true,
    idleMinutes: 15,
    includeShells: false,
  },
};

function clampRetentionDays(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.pasteImageRetentionDays;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > 365) return 365;
  return v;
}

function clampIdleMinutes(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.hibernation.idleMinutes;
  const v = Math.floor(n);
  if (v < 5) return 5;
  if (v > 180) return 180;
  return v;
}

function readHibernation(raw: unknown): HibernationSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS.hibernation };
  const o = raw as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULTS.hibernation.enabled,
    idleMinutes: clampIdleMinutes(o.idleMinutes),
    includeShells:
      typeof o.includeShells === "boolean" ? o.includeShells : DEFAULTS.hibernation.includeShells,
  };
}

function readFromDisk(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULTS, hibernation: { ...DEFAULTS.hibernation } };
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULTS, hibernation: { ...DEFAULTS.hibernation } };
    const obj = parsed as Record<string, unknown>;
    return {
      pasteImageRetentionDays: clampRetentionDays(obj.pasteImageRetentionDays),
      hibernation: readHibernation(obj.hibernation),
    };
  } catch {
    return { ...DEFAULTS, hibernation: { ...DEFAULTS.hibernation } };
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
export interface AppSettingsPatch {
  pasteImageRetentionDays?: number;
  hibernation?: Partial<HibernationSettings>;
}

export function setAppSettings(patch: AppSettingsPatch): AppSettings {
  mkdirSync(DATA_DIR, { recursive: true });
  const current = readFromDisk();
  const mergedHibernation: HibernationSettings = patch.hibernation
    ? {
        enabled:
          typeof patch.hibernation.enabled === "boolean"
            ? patch.hibernation.enabled
            : current.hibernation.enabled,
        idleMinutes: clampIdleMinutes(
          patch.hibernation.idleMinutes ?? current.hibernation.idleMinutes,
        ),
        includeShells:
          typeof patch.hibernation.includeShells === "boolean"
            ? patch.hibernation.includeShells
            : current.hibernation.includeShells,
      }
    : current.hibernation;
  const next: AppSettings = {
    pasteImageRetentionDays: clampRetentionDays(
      patch.pasteImageRetentionDays ?? current.pasteImageRetentionDays,
    ),
    hibernation: mergedHibernation,
  };
  const tmp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, SETTINGS_PATH);
  return next;
}
