import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// wechat/ lives one level deeper than the other server modules, so climb two.
const SERVER_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = resolve(SERVER_ROOT, "data");
const CONFIG_PATH = resolve(DATA_DIR, "wechat.json");

export const ILINK_LOGIN_BASE = "https://ilinkai.weixin.qq.com";

/**
 * Persisted WeChat (ilink) bridge config. Stored PLAINTEXT in `data/wechat.json`
 * (the whole `data/` dir is gitignored) — same decision as feishu.json. Only
 * credentials / switch / cursor / owner live here; runtime state (QR, conn
 * state, binding window, pending request) is memory-only by design.
 */
export interface WechatConfig {
  /** Master switch. Even with a token present, false keeps the bridge dormant. */
  enabled: boolean;
  /** ilink bot_token from QR login. Empty = not logged in. */
  botToken: string;
  /** API base after login (validated: https + *.weixin.qq.com). */
  baseUrl: string;
  /** getupdates long-poll cursor. Lost cursor => duplicate deliveries. */
  getUpdatesBuf: string;
  /** Bound owner's from_user_id (xxx@im.wechat). Empty = nobody bound. */
  ownerUserId: string;
}

/** What the browser receives — token itself never leaves the server. */
export interface WechatConfigMasked extends Omit<WechatConfig, "botToken" | "getUpdatesBuf"> {
  hasToken: boolean;
}

const DEFAULTS: WechatConfig = {
  enabled: false,
  botToken: "",
  baseUrl: ILINK_LOGIN_BASE,
  getUpdatesBuf: "",
  ownerUserId: "",
};

function asString(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

/** baseUrl 白名单：必须 https 且落在微信 ilink 域内，防止凭证被发往别处。 */
export function isAllowedIlinkBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return u.hostname === "ilinkai.weixin.qq.com" || u.hostname.endsWith(".weixin.qq.com");
  } catch {
    return false;
  }
}

/**
 * Read + sanitize from disk. Never throws: a missing or corrupt file collapses
 * to safe disabled defaults (same contract as feishu/config.ts).
 */
export function getWechatConfig(): WechatConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const baseUrl = asString(raw.baseUrl, ILINK_LOGIN_BASE).trim();
    return {
      enabled: raw.enabled === true,
      botToken: asString(raw.botToken, ""),
      baseUrl: isAllowedIlinkBaseUrl(baseUrl) ? baseUrl : ILINK_LOGIN_BASE,
      getUpdatesBuf: asString(raw.getUpdatesBuf, ""),
      ownerUserId: asString(raw.ownerUserId, "").trim(),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function maskWechatConfig(cfg: WechatConfig): WechatConfigMasked {
  const { botToken, getUpdatesBuf: _buf, ...rest } = cfg;
  return { ...rest, hasToken: botToken.length > 0 };
}

export interface WechatConfigPatch {
  enabled?: boolean;
  botToken?: string;
  baseUrl?: string;
  getUpdatesBuf?: string;
  ownerUserId?: string;
}

/** Atomic write (tmp + rename), mirrors feishu/config.ts. Returns merged config. */
export function setWechatConfig(patch: WechatConfigPatch): WechatConfig {
  mkdirSync(DATA_DIR, { recursive: true });
  const current = getWechatConfig();
  const nextBase = typeof patch.baseUrl === "string" ? patch.baseUrl.trim() : current.baseUrl;
  const next: WechatConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    botToken: typeof patch.botToken === "string" ? patch.botToken : current.botToken,
    baseUrl: isAllowedIlinkBaseUrl(nextBase) ? nextBase : ILINK_LOGIN_BASE,
    getUpdatesBuf: typeof patch.getUpdatesBuf === "string" ? patch.getUpdatesBuf : current.getUpdatesBuf,
    ownerUserId: typeof patch.ownerUserId === "string" ? patch.ownerUserId.trim() : current.ownerUserId,
  };
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  renameSync(tmp, CONFIG_PATH);
  return next;
}

/** Bridge can poll only with both: enabled + a stored token. */
export function isWechatConfigured(cfg: WechatConfig): boolean {
  return cfg.enabled && cfg.botToken.length > 0;
}
