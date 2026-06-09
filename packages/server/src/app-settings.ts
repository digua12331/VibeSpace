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

/**
 * 「经理 AI 受约束派工」边界设置。普通项(concurrency/confirmGraph/stopOnFailure)
 * 是行为调节;危险项(allow*)默认 false(锁死)。**危险项不靠经理 AI 自报判定**——
 * 后端在子任务跑完后按实际 git diff 硬检测(见 routes/task-subtasks.ts),
 * 这里只是"是否放行"的总开关。
 */
export interface ManagerBoundarySettings {
  /** 经理 AI 可同时派发的 worktree 子任务上限。Bounded to [1, 3]; 默认 2。 */
  concurrency: number;
  /** true 时 dispatch 必须带与任务图绑定的确认凭证(派工前给大哥看图确认)。 */
  confirmGraph: boolean;
  /** true 时某子任务失败/被阻断会停掉该图所有未派发波次。 */
  stopOnFailure: boolean;
  /** 【实验·默认关】true 时后端定时唤醒空闲的经理会话去盯进度(子任务待合并/失败时)。
   *  这是半自主循环,仍严格保留确认/危险/合并三闸口;未经活模型充分验证,谨慎开启。 */
  autoWake: boolean;
  /** 允许子任务改动落到数据库(默认 false,后端按实际 diff 拦截)。 */
  allowDbChanges: boolean;
  /** 允许子任务删除文件(默认 false,后端按 git diff --name-status 拦截)。 */
  allowFileDelete: boolean;
  /** 允许经理 AI 自动合并(默认 false)。开时经理可调 auto-approve-all,
   *  仅合并 verify 过+危险无命中+无冲突的子任务;关时只能人工合并。 */
  allowAutoMerge: boolean;
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
  /**
   * Max number of concurrently open AI terminal sessions before the UI blocks
   * starting a new one. Only AI terminals count — file/HTML preview tabs don't.
   * Bounded to [1, 50] at the REST boundary; 12 is the engineering default.
   */
  maxAiTerminals: number;
  manager: ManagerBoundarySettings;
}

const DEFAULTS: AppSettings = {
  pasteImageRetentionDays: 1,
  maxAiTerminals: 12,
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
  manager: {
    concurrency: 2,
    confirmGraph: true,
    stopOnFailure: true,
    autoWake: false,
    // 危险项默认全锁死。
    allowDbChanges: false,
    allowFileDelete: false,
    allowAutoMerge: false,
  },
};

function clampRetentionDays(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.pasteImageRetentionDays;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > 365) return 365;
  return v;
}

function clampMaxAiTerminals(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.maxAiTerminals;
  const v = Math.floor(n);
  if (v < 1) return 1;
  if (v > 50) return 50;
  return v;
}

function clampConcurrency(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULTS.manager.concurrency;
  const v = Math.floor(n);
  if (v < 1) return 1;
  if (v > 3) return 3;
  return v;
}

function readManager(raw: unknown): ManagerBoundarySettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS.manager };
  const o = raw as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    concurrency: clampConcurrency(o.concurrency),
    confirmGraph: bool(o.confirmGraph, DEFAULTS.manager.confirmGraph),
    stopOnFailure: bool(o.stopOnFailure, DEFAULTS.manager.stopOnFailure),
    autoWake: bool(o.autoWake, DEFAULTS.manager.autoWake),
    allowDbChanges: bool(o.allowDbChanges, DEFAULTS.manager.allowDbChanges),
    allowFileDelete: bool(o.allowFileDelete, DEFAULTS.manager.allowFileDelete),
    allowAutoMerge: bool(o.allowAutoMerge, DEFAULTS.manager.allowAutoMerge),
  };
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
    manager: { ...DEFAULTS.manager },
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
      maxAiTerminals: clampMaxAiTerminals(obj.maxAiTerminals),
      manager: readManager(obj.manager),
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
  maxAiTerminals?: number;
  manager?: Partial<ManagerBoundarySettings>;
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
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const mergedManager: ManagerBoundarySettings = patch.manager
    ? {
        concurrency: clampConcurrency(patch.manager.concurrency ?? current.manager.concurrency),
        confirmGraph: bool(patch.manager.confirmGraph, current.manager.confirmGraph),
        stopOnFailure: bool(patch.manager.stopOnFailure, current.manager.stopOnFailure),
        autoWake: bool(patch.manager.autoWake, current.manager.autoWake),
        allowDbChanges: bool(patch.manager.allowDbChanges, current.manager.allowDbChanges),
        allowFileDelete: bool(patch.manager.allowFileDelete, current.manager.allowFileDelete),
        allowAutoMerge: bool(patch.manager.allowAutoMerge, current.manager.allowAutoMerge),
      }
    : current.manager;
  const next: AppSettings = {
    pasteImageRetentionDays: clampRetentionDays(
      patch.pasteImageRetentionDays ?? current.pasteImageRetentionDays,
    ),
    hibernation: mergedHibernation,
    terminalKeybindings: mergedKeybindings,
    maxAiTerminals: clampMaxAiTerminals(
      patch.maxAiTerminals ?? current.maxAiTerminals,
    ),
    manager: mergedManager,
  };
  const tmp = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, SETTINGS_PATH);
  return next;
}
