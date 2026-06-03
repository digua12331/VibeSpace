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

/**
 * A single physical key combination, mirrored from the browser's
 * `KeyboardEvent` shape. `key` is the raw `KeyboardEvent.key` value
 * (e.g. "F8", "k"). Modifier flags default to false when absent.
 */
export interface KeyCombo {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/**
 * User-recorded *alternate* keys for the two terminal abort actions. These
 * are ADDITIVE — the built-in Esc (`\x1b`) and Ctrl+C (`\x03`) always stay
 * live; an alt key, when set, fires the same byte. `null` means "no alt key".
 */
export interface TerminalKeybindings {
  abortAltKey: KeyCombo | null;
  interruptAltKey: KeyCombo | null;
}

export interface AppSettings {
  /**
   * Days to keep pasted images under each project's `.vibespace/pasted-images/`.
   * `0` means "do not prune"; the prune routine early-returns. Bounded to
   * [0, 365] at the REST boundary.
   */
  pasteImageRetentionDays: number;
  hibernation: HibernationSettings;
  terminalKeybindings: TerminalKeybindings;
}

const DEFAULTS: AppSettings = {
  pasteImageRetentionDays: 1,
  hibernation: {
    // 默认关闭：闲置自动休眠会 kill 掉正在跑的 AI 会话 PTY，用户感知为
    // "终端放着不动就没了"。想省资源的用户可在「设置」对话框手动开启。
    enabled: false,
    idleMinutes: 15,
    includeShells: false,
  },
  terminalKeybindings: {
    abortAltKey: null,
    interruptAltKey: null,
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

/** Sanitize one persisted key combo; any malformed shape collapses to null. */
function readKeyCombo(raw: unknown): KeyCombo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "string" || o.key.length === 0) return null;
  const combo: KeyCombo = { key: o.key };
  if (o.ctrl === true) combo.ctrl = true;
  if (o.alt === true) combo.alt = true;
  if (o.shift === true) combo.shift = true;
  if (o.meta === true) combo.meta = true;
  return combo;
}

function readTerminalKeybindings(raw: unknown): TerminalKeybindings {
  if (!raw || typeof raw !== "object") return { abortAltKey: null, interruptAltKey: null };
  const o = raw as Record<string, unknown>;
  return {
    abortAltKey: readKeyCombo(o.abortAltKey),
    interruptAltKey: readKeyCombo(o.interruptAltKey),
  };
}

function freshDefaults(): AppSettings {
  return {
    ...DEFAULTS,
    hibernation: { ...DEFAULTS.hibernation },
    terminalKeybindings: { ...DEFAULTS.terminalKeybindings },
  };
}

// ---- Keybinding validation (backend backstop; frontend mirrors these rules
// for instant feedback — kept as two small copies rather than a shared package). ----

const MODIFIER_KEY_NAMES = new Set([
  "Control", "Shift", "Alt", "Meta", "OS", "AltGraph",
  "CapsLock", "ContextMenu", "Dead", "Process", "Unidentified",
]);
const TUI_RESERVED_KEYS = new Set([
  "Enter", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Backspace", "Home", "End", "PageUp", "PageDown",
]);

/** Returns a human-readable reason string if the combo is not allowed, else null. */
export function keyComboError(c: KeyCombo): string | null {
  const key = c.key;
  if (!key) return "按键为空";
  if (MODIFIER_KEY_NAMES.has(key)) return "不能只用修饰键";
  if (key === "Escape") return "不能用 Esc（已是默认中止键）";
  if (TUI_RESERVED_KEYS.has(key)) return `不能用 ${key}（终端导航保留键）`;
  const ctrl = c.ctrl === true, alt = c.alt === true, meta = c.meta === true;
  if (ctrl && !alt && !meta && (key === "c" || key === "C"))
    return "不能用 Ctrl+C（已是默认强制中断键）";
  if ((ctrl || meta) && (key === "v" || key === "V"))
    return "不能用粘贴快捷键";
  if (key.length === 1 && !ctrl && !alt && !meta)
    return "单个字符键太容易误触，请加 Ctrl/Alt 修饰或用 F1–F12";
  return null;
}

export function keyCombosEqual(a: KeyCombo | null, b: KeyCombo | null): boolean {
  if (!a || !b) return false;
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift &&
    !!a.meta === !!b.meta
  );
}

function readFromDisk(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return freshDefaults();
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return freshDefaults();
    const obj = parsed as Record<string, unknown>;
    return {
      pasteImageRetentionDays: clampRetentionDays(obj.pasteImageRetentionDays),
      hibernation: readHibernation(obj.hibernation),
      terminalKeybindings: readTerminalKeybindings(obj.terminalKeybindings),
    };
  } catch {
    return freshDefaults();
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
  terminalKeybindings?: Partial<TerminalKeybindings>;
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
  const mergedKeybindings: TerminalKeybindings = patch.terminalKeybindings
    ? {
        abortAltKey:
          patch.terminalKeybindings.abortAltKey !== undefined
            ? readKeyCombo(patch.terminalKeybindings.abortAltKey)
            : current.terminalKeybindings.abortAltKey,
        interruptAltKey:
          patch.terminalKeybindings.interruptAltKey !== undefined
            ? readKeyCombo(patch.terminalKeybindings.interruptAltKey)
            : current.terminalKeybindings.interruptAltKey,
      }
    : current.terminalKeybindings;
  const next: AppSettings = {
    pasteImageRetentionDays: clampRetentionDays(
      patch.pasteImageRetentionDays ?? current.pasteImageRetentionDays,
    ),
    hibernation: mergedHibernation,
    terminalKeybindings: mergedKeybindings,
  };
  const tmp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, SETTINGS_PATH);
  return next;
}
