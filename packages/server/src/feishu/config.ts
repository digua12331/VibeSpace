import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// feishu/ lives one level deeper than the other server modules, so climb two.
const SERVER_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = resolve(SERVER_ROOT, "data");
const CONFIG_PATH = resolve(DATA_DIR, "feishu.json");

/**
 * Persisted Feishu bridge config. Stored PLAINTEXT in `data/feishu.json`
 * (the whole `data/` dir is gitignored). v1 does not encrypt the secret —
 * see plan「明文密钥」note. Missing file / missing fields => bridge stays off.
 */
export interface FeishuConfig {
  /** Master switch. Even with creds present, false keeps the bridge dormant. */
  enabled: boolean;
  appId: string;
  appSecret: string;
  /** Feishu (cn) vs Lark (intl) endpoint. */
  domain: "feishu" | "lark";
  /** 私聊白名单：发消息者 open_id。空 = 全拒（安全默认）。 */
  allowOpenIds: string[];
  /** 群白名单：chat_id。群在名单≠群内人人有权，但 v1 以群粒度放行。 */
  allowChatIds: string[];
  /** 出站目标：主动消息 / worker 通知发给这个 open_id（大哥本人）。 */
  ownerOpenId: string;
  /** 总控台 agent，固定 claude（hub 工具校验 claude-only）。留字段便于将来放开。 */
  hubAgent: string;
}

/** What the browser receives — secret is masked, never the raw value. */
export interface FeishuConfigMasked extends Omit<FeishuConfig, "appSecret"> {
  /** True if a secret is stored (so UI can show「已保存」without leaking it). */
  hasSecret: boolean;
  /** Masked placeholder, e.g. `••••••1234`, or "" when no secret stored. */
  appSecretMask: string;
}

const DEFAULTS: FeishuConfig = {
  enabled: false,
  appId: "",
  appSecret: "",
  domain: "feishu",
  allowOpenIds: [],
  allowChatIds: [],
  ownerOpenId: "",
  hubAgent: "claude",
};

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function asString(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

/**
 * Read + sanitize from disk. Never throws: a missing or corrupt file collapses
 * to safe disabled defaults and logs nothing here (callers decide). This keeps
 * a bad config file from taking down server startup.
 */
export function getFeishuConfig(): FeishuConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS, allowOpenIds: [], allowChatIds: [] };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    return {
      enabled: raw.enabled === true,
      appId: asString(raw.appId, "").trim(),
      appSecret: asString(raw.appSecret, ""),
      domain: raw.domain === "lark" ? "lark" : "feishu",
      allowOpenIds: asStringArray(raw.allowOpenIds),
      allowChatIds: asStringArray(raw.allowChatIds),
      ownerOpenId: asString(raw.ownerOpenId, "").trim(),
      hubAgent: asString(raw.hubAgent, "claude").trim() || "claude",
    };
  } catch {
    return { ...DEFAULTS, allowOpenIds: [], allowChatIds: [] };
  }
}

function maskSecret(secret: string): string {
  if (!secret) return "";
  const tail = secret.slice(-4);
  return `••••••${tail}`;
}

export function maskFeishuConfig(cfg: FeishuConfig): FeishuConfigMasked {
  const { appSecret, ...rest } = cfg;
  return { ...rest, hasSecret: appSecret.length > 0, appSecretMask: maskSecret(appSecret) };
}

export interface FeishuConfigPatch {
  enabled?: boolean;
  appId?: string;
  /** Omit or send the unchanged mask to keep the stored secret. */
  appSecret?: string;
  domain?: "feishu" | "lark";
  allowOpenIds?: string[];
  allowChatIds?: string[];
  ownerOpenId?: string;
  hubAgent?: string;
}

/** The mask placeholder the UI echoes back when the user didn't retype the secret. */
function isMaskPlaceholder(s: string): boolean {
  return s.startsWith("••••••");
}

/**
 * Atomic write (tmp + rename), mirrors app-settings.ts. Returns the merged
 * config. A patched `appSecret` that is empty or still the mask placeholder
 * preserves the existing stored secret rather than wiping it.
 */
export function setFeishuConfig(patch: FeishuConfigPatch): FeishuConfig {
  mkdirSync(DATA_DIR, { recursive: true });
  const current = getFeishuConfig();
  let nextSecret = current.appSecret;
  if (typeof patch.appSecret === "string" && patch.appSecret.length > 0 && !isMaskPlaceholder(patch.appSecret)) {
    nextSecret = patch.appSecret;
  }
  const next: FeishuConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    appId: typeof patch.appId === "string" ? patch.appId.trim() : current.appId,
    appSecret: nextSecret,
    domain: patch.domain === "lark" ? "lark" : patch.domain === "feishu" ? "feishu" : current.domain,
    allowOpenIds: patch.allowOpenIds !== undefined ? asStringArray(patch.allowOpenIds) : current.allowOpenIds,
    allowChatIds: patch.allowChatIds !== undefined ? asStringArray(patch.allowChatIds) : current.allowChatIds,
    ownerOpenId: typeof patch.ownerOpenId === "string" ? patch.ownerOpenId.trim() : current.ownerOpenId,
    hubAgent: typeof patch.hubAgent === "string" && patch.hubAgent.trim() ? patch.hubAgent.trim() : current.hubAgent,
  };
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, CONFIG_PATH);
  return next;
}

export function getFeishuConfigPath(): string {
  return CONFIG_PATH;
}

/** Bridge can run only with all three: enabled + appId + appSecret. */
export function isFeishuConfigured(cfg: FeishuConfig): boolean {
  return cfg.enabled && cfg.appId.length > 0 && cfg.appSecret.length > 0;
}

/** Whitelist check: private chat keys on sender open_id, group on chat_id. Empty list => deny all. */
export function isSenderAllowed(cfg: FeishuConfig, chatType: string, openId: string | undefined, chatId: string | undefined): boolean {
  if (chatType === "p2p") {
    return !!openId && cfg.allowOpenIds.includes(openId);
  }
  // group / topic
  return !!chatId && cfg.allowChatIds.includes(chatId);
}
