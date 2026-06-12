/**
 * AI 资讯原文抓取 —— 按 daily-brief 缓存里的 primaryUrl 抓原文网页并提取纯文本正文。
 *
 * 安全模型（plan「AI资讯详情抓原文」）：
 * - 入口只接收 storyId，目标 URL 由 routes/radar.ts 的缓存解析，客户端无法传任意地址；
 * - 即便是缓存里的 URL 也按不可信处理：协议必须 http/https，主机名若是 IP 字面量直接判，
 *   域名则通过传给 net/tls 实际建连的 lookup 钩子校验解析结果——校验绑定到真正连接的
 *   地址上，DNS 重绑定（校验后域名改指内网）无法绕过；
 * - 重定向手动逐跳处理（最多 REDIRECT_LIMIT 跳），每跳重新走完整校验；
 * - 响应体流式累计字节数，超 MAX_BODY_BYTES 立即断开，不信 Content-Length。
 *
 * 所有网络 IO 走可注入的 HttpGetLike，自测脚本用假 transport 覆盖各失败分支。
 */
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as dns from "node:dns";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { RadarError } from "./routes/radar.js";

const FETCH_TIMEOUT_MS = 15_000;
const REDIRECT_LIMIT = 5;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MIN_TEXT_CHARS = 200;
const MAX_TEXT_CHARS = 50_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface RadarArticle {
  storyId: string;
  sourceUrl: string;
  title: string | null;
  /** 纯文本正文，段落以 \n\n 分隔；不含任何 HTML。 */
  textContent: string;
  charCount: number;
  truncated: boolean;
  fetchedAt: number;
  cached: boolean;
}

/* ------------------------------------------------------------------ */
/* SSRF：公网地址校验                                                   */
/* ------------------------------------------------------------------ */

/** IPv4 点分字符串是否属于禁止访问的范围（回环/私网/链路本地/保留/组播等）。 */
function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // 解析不了的当禁止处理
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // 回环
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a >= 224) return true; // 组播 224/4 + 保留 240/4 + 广播
  return false;
}

/** 任意 IP 字面量（v4/v6）是否禁止访问。非 IP 返回 true（调用方先确认 isIP）。 */
export function isForbiddenAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isForbiddenIPv4(ip);
  if (family !== 6) return true;
  const lower = ip.toLowerCase();
  // IPv4 映射地址（::ffff:1.2.3.4）按内层 v4 判
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isForbiddenIPv4(mapped[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // fe80::/10 链路本地
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("ff")) return true; // ff00::/8 组播
  return false;
}

/**
 * 校验 URL 的协议与主机：
 * - 仅 http/https；
 * - 主机名是 IP 字面量时就地判定；域名留给连接期 lookup 钩子。
 */
export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RadarError("原文地址不是合法 URL", "radar_article_blocked", 403);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new RadarError("原文地址协议不允许", "radar_article_blocked", 403);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isForbiddenAddress(host)) {
    throw new RadarError("原文地址指向内网或保留地址，已拒绝", "radar_article_blocked", 403);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new RadarError("原文地址指向本机，已拒绝", "radar_article_blocked", 403);
  }
  return u;
}

/**
 * 传给 net/tls 实际建连的 lookup：解析后逐个校验地址，命中禁止范围即报错。
 * 校验结果就是建连用的地址，DNS 重绑定无从插队。
 */
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) {
      return callback(Object.assign(new Error("域名无解析结果"), { code: "ENOTFOUND" }), []);
    }
    const bad = list.find((a) => isForbiddenAddress(a.address));
    if (bad) {
      return callback(
        Object.assign(new Error("RADAR_FORBIDDEN_ADDRESS"), { code: "RADAR_FORBIDDEN_ADDRESS" }),
        [],
      );
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/* ------------------------------------------------------------------ */
/* 受控 HTTP GET（可注入）                                              */
/* ------------------------------------------------------------------ */

export interface HttpGetResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** 已按 MAX_BODY_BYTES 截止的原始字节。 */
  body: Buffer;
}

export type HttpGetLike = (url: URL) => Promise<HttpGetResult>;

/** 单次 GET：lookup 绑定校验、超时、流式字节上限。不跟随重定向。 */
function httpGetOnce(url: URL): Promise<HttpGetResult> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) {
            res.destroy();
            req.destroy();
            reject(new RadarError("原文页面超过 2MB，已中止", "radar_article_failed", 502));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", (e) => reject(e));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("RADAR_TIMEOUT"));
    });
    req.on("error", (e: NodeJS.ErrnoException) => {
      if ((e as NodeJS.ErrnoException).code === "RADAR_FORBIDDEN_ADDRESS" || e.message === "RADAR_FORBIDDEN_ADDRESS") {
        reject(new RadarError("原文域名解析到内网或保留地址，已拒绝", "radar_article_blocked", 403));
      } else if (e.message === "RADAR_TIMEOUT") {
        reject(new RadarError("抓取原文超时", "radar_article_timeout", 504));
      } else {
        reject(e);
      }
    });
    req.end();
  });
}

/** GET + 手动逐跳重定向，每跳重新走 assertSafeUrl + lookup 校验。 */
export async function fetchWithRedirects(
  rawUrl: string,
  httpGet: HttpGetLike = httpGetOnce,
): Promise<{ result: HttpGetResult; finalUrl: URL }> {
  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
    let result: HttpGetResult;
    try {
      result = await httpGet(url);
    } catch (e) {
      if (e instanceof RadarError) throw e;
      throw new RadarError(
        `抓取原文失败: ${(e as Error)?.message ?? String(e)}`,
        "radar_article_failed",
        502,
      );
    }
    if (result.status >= 300 && result.status < 400) {
      const loc = result.headers.location;
      const locStr = Array.isArray(loc) ? loc[0] : loc;
      if (!locStr) {
        throw new RadarError("原文返回重定向但缺少目标地址", "radar_article_failed", 502);
      }
      // 相对 Location 基于当前 URL 解析，解析结果同样过完整校验
      url = assertSafeUrl(new URL(locStr, url).toString());
      continue;
    }
    return { result, finalUrl: url };
  }
  throw new RadarError("原文重定向次数过多，已中止", "radar_article_failed", 502);
}

/* ------------------------------------------------------------------ */
/* 解码与正文提取                                                       */
/* ------------------------------------------------------------------ */

/** 从 Content-Type 头或 HTML 头部 meta 嗅探 charset，默认 utf-8。 */
export function detectCharset(contentType: string | undefined, head: Buffer): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const headText = head.toString("latin1");
  const fromMeta =
    headText.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    headText.match(/content=["'][^"']*charset=([\w-]+)/i)?.[1];
  return (fromMeta ?? "utf-8").toLowerCase();
}

export function decodeBody(body: Buffer, contentType: string | undefined): string {
  const charset = detectCharset(contentType, body.subarray(0, 2048));
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** readability 提取正文 → 纯文本段落。提取不出/太短抛 unextractable。 */
export function extractArticleText(html: string, url: string): {
  title: string | null;
  textContent: string;
  truncated: boolean;
} {
  let parsed: { title?: string | null; textContent?: string | null } | null = null;
  try {
    const { document } = parseHTML(html);
    parsed = new Readability(document as unknown as Document).parse();
  } catch {
    parsed = null;
  }
  const rawText = parsed?.textContent ?? "";
  // 规整空白：行内空白压一格，连续空行压成段落分隔
  const text = rawText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
  if (text.length < MIN_TEXT_CHARS) {
    throw new RadarError(
      "原文页面提取不出足够正文（可能需要登录、被反爬或为动态页面）",
      "radar_article_unextractable",
      422,
    );
  }
  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    title: parsed?.title?.trim() || null,
    textContent: truncated ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n…（正文过长，已截断）` : text,
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* 内存缓存 + 对外入口                                                  */
/* ------------------------------------------------------------------ */

interface ArticleCacheSlot {
  fetchedAt: number;
  article: Omit<RadarArticle, "storyId" | "cached">;
}

const _articleCache = new Map<string, ArticleCacheSlot>();

/** 仅供测试脚本重置缓存。 */
export function resetArticleCache(): void {
  _articleCache.clear();
}

export async function fetchRadarArticle(opts: {
  storyId: string;
  url: string;
  httpGet?: HttpGetLike;
  now?: () => number;
}): Promise<RadarArticle> {
  const now = opts.now ?? Date.now;
  const hit = _articleCache.get(opts.url);
  if (hit && now() - hit.fetchedAt < CACHE_TTL_MS) {
    return { storyId: opts.storyId, cached: true, ...hit.article };
  }
  const { result, finalUrl } = await fetchWithRedirects(opts.url, opts.httpGet);
  if (result.status < 200 || result.status >= 300) {
    throw new RadarError(`原文站点返回 HTTP ${result.status}`, "radar_article_failed", 502);
  }
  const ct = result.headers["content-type"];
  const ctStr = (Array.isArray(ct) ? ct[0] : ct) ?? "";
  if (ctStr && !/text\/html|application\/xhtml/i.test(ctStr)) {
    throw new RadarError("原文不是网页（可能是 PDF/图片等），无法提取正文", "radar_article_unextractable", 422);
  }
  const html = decodeBody(result.body, ctStr || undefined);
  const { title, textContent, truncated } = extractArticleText(html, finalUrl.toString());
  const article: Omit<RadarArticle, "storyId" | "cached"> = {
    sourceUrl: opts.url,
    title,
    textContent,
    charCount: textContent.length,
    truncated,
    fetchedAt: now(),
  };
  if (_articleCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = _articleCache.keys().next().value;
    if (oldest !== undefined) _articleCache.delete(oldest);
  }
  _articleCache.set(opts.url, { fetchedAt: article.fetchedAt, article });
  return { storyId: opts.storyId, cached: false, ...article };
}
