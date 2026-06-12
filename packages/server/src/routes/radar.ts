/**
 * AI 资讯雷达 —— 代理 LearnPrompt/ai-news-radar 在 GitHub Pages 上的公开
 * daily-brief.json（精选故事线，免鉴权）。全机器级能力，挂独立 /api/radar/*。
 *
 * 上游是外部输入：TS 类型管不到真实数据，所有字段走运行时归一化
 * （normalizeDailyBrief）——数组字段缺失回落空数组，坏 story 跳过，
 * 整体结构不可用抛 RadarError 由路由映射成结构化错误。
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { serverLog } from "../log-bus.js";
import { fetchRadarArticle } from "../radar-article.js";

const UPSTREAM_URL =
  "https://learnprompt.github.io/ai-news-radar/data/daily-brief.json";
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export class RadarError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number,
  ) {
    super(message);
    this.name = "RadarError";
  }
}

export interface RadarSource {
  title: string;
  url: string | null;
  sourceName: string;
  publishedAt: string | null;
}

export interface RadarStory {
  storyId: string;
  title: string;
  primaryUrl: string | null;
  category: string | null;
  importanceLabel: string | null;
  score: number | null;
  reasons: string[];
  sources: RadarSource[];
  sourceCount: number;
  earliestAt: string | null;
  latestAt: string | null;
}

export interface RadarDailyBrief {
  generatedAt: string | null;
  fetchedAt: number;
  cached: boolean;
  items: RadarStory[];
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asHttpUrl(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeStory(raw: unknown, index: number): RadarStory | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = asString(o.title);
  // 没有标题的故事无法展示也无法点开，跳过该条不拖垮整体。
  if (!title) return null;
  const primaryUrl = asHttpUrl(o.primary_url) ?? asHttpUrl(o.url);
  const sources: RadarSource[] = asArray(o.sources)
    .map((s): RadarSource | null => {
      if (!s || typeof s !== "object") return null;
      const so = s as Record<string, unknown>;
      const stitle = asString(so.title);
      if (!stitle) return null;
      return {
        title: stitle,
        url: asHttpUrl(so.url),
        sourceName: asString(so.source_name) ?? asString(so.source) ?? "未知来源",
        publishedAt: asString(so.published_at),
      };
    })
    .filter((s): s is RadarSource => s != null);
  return {
    // story_id 缺失/重复时用 url+位置合成稳定键，前端页签去重依赖它。
    storyId: asString(o.story_id) ?? `synthetic:${primaryUrl ?? "no-url"}:${index}`,
    title,
    primaryUrl,
    category: asString(o.category),
    importanceLabel: asString(o.importance_label),
    score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null,
    reasons: asArray(o.reasons)
      .map((r) => asString(r))
      .filter((r): r is string => r != null),
    sources,
    sourceCount:
      typeof o.source_count === "number" && Number.isFinite(o.source_count)
        ? o.source_count
        : sources.length,
    earliestAt: asString(o.earliest_at),
    latestAt: asString(o.latest_at),
  };
}

export function normalizeDailyBrief(raw: unknown): {
  generatedAt: string | null;
  items: RadarStory[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RadarError(
      "上游返回的不是预期的 JSON 对象",
      "radar_invalid_payload",
      502,
    );
  }
  const o = raw as Record<string, unknown>;
  const items = asArray(o.items)
    .map((s, i) => normalizeStory(s, i))
    .filter((s): s is RadarStory => s != null);
  return { generatedAt: asString(o.generated_at), items };
}

type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface CacheSlot {
  fetchedAt: number;
  generatedAt: string | null;
  items: RadarStory[];
}

let _cache: CacheSlot | null = null;

/** 仅供测试脚本重置缓存。 */
export function resetRadarCache(): void {
  _cache = null;
}

/**
 * 从最近一次成功的 daily-brief 结果里按 storyId 找故事（过期缓存也算——
 * _cache 过期后不清空，旧 tab 仍能解析；服务器重启后才真正找不到）。
 * 原文抓取的 URL 只能来自这里，客户端无法传任意地址。
 */
export function findCachedStory(storyId: string): RadarStory | null {
  return _cache?.items.find((s) => s.storyId === storyId) ?? null;
}

export async function fetchDailyBrief(opts: {
  force: boolean;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<RadarDailyBrief> {
  const now = opts.now ?? Date.now;
  if (!opts.force && _cache && now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return {
      generatedAt: _cache.generatedAt,
      fetchedAt: _cache.fetchedAt,
      cached: true,
      items: _cache.items,
    };
  }
  const fetchImpl: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(UPSTREAM_URL, { signal: ac.signal });
  } catch (e: unknown) {
    if ((e as Error)?.name === "AbortError") {
      throw new RadarError("上游请求超时", "radar_upstream_timeout", 504);
    }
    throw new RadarError(
      `上游请求失败: ${(e as Error)?.message ?? String(e)}`,
      "radar_upstream_failed",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new RadarError(
      `上游返回 HTTP ${res.status}`,
      "radar_upstream_failed",
      502,
    );
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new RadarError("上游返回的不是 JSON", "radar_invalid_payload", 502);
  }
  const { generatedAt, items } = normalizeDailyBrief(raw);
  _cache = { fetchedAt: now(), generatedAt, items };
  return { generatedAt, fetchedAt: _cache.fetchedAt, cached: false, items };
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof RadarError) {
    return reply
      .code(err.httpStatus)
      .send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "radar_failed", message: msg });
}

export async function registerRadarRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /api/radar/daily-brief ----------
  app.get("/api/radar/daily-brief", async (req, reply) => {
    const force =
      (req.query as Record<string, unknown> | undefined)?.force === "1";
    const t0 = Date.now();
    serverLog("info", "radar", "radar-fetch 开始", { meta: { force } });
    try {
      const brief = await fetchDailyBrief({ force });
      serverLog("info", "radar", `radar-fetch 成功 (${Date.now() - t0}ms)`, {
        meta: {
          force,
          cached: brief.cached,
          itemCount: brief.items.length,
          generatedAt: brief.generatedAt,
        },
      });
      return reply.send(brief);
    } catch (err: unknown) {
      serverLog("error", "radar", `radar-fetch 失败: ${(err as Error)?.message}`, {
        meta: {
          force,
          error: {
            name: (err as Error)?.name,
            message: (err as Error)?.message,
          },
        },
      });
      return sendError(reply, err);
    }
  });

  // ---------- GET /api/radar/article ----------
  // 只接收 storyId；URL 由 daily-brief 缓存解析（SSRF 授权第一道闸）。
  // 日志只记 host/耗时/字数，不落盘完整 URL、正文、HTML。
  app.get("/api/radar/article", async (req, reply) => {
    const storyId = (req.query as Record<string, unknown> | undefined)?.storyId;
    if (typeof storyId !== "string" || storyId.length === 0) {
      return reply
        .code(400)
        .send({ error: "radar_bad_request", message: "缺少 storyId" });
    }
    const t0 = Date.now();
    serverLog("info", "radar", "radar-article 开始", { meta: { storyId } });
    try {
      let story = findCachedStory(storyId);
      if (!story) {
        // 服务器刚重启缓存为空时，先拉一次列表再找，旧 tab 不至于全部 404
        await fetchDailyBrief({ force: false }).catch(() => undefined);
        story = findCachedStory(storyId);
      }
      if (!story) {
        throw new RadarError(
          "该资讯不在当前列表缓存中，无法抓取原文",
          "radar_story_not_found",
          404,
        );
      }
      if (!story.primaryUrl) {
        throw new RadarError("该资讯没有可用的原文地址", "radar_article_failed", 502);
      }
      const article = await fetchRadarArticle({ storyId, url: story.primaryUrl });
      serverLog("info", "radar", `radar-article 成功 (${Date.now() - t0}ms)`, {
        meta: {
          storyId,
          host: new URL(story.primaryUrl).hostname,
          cached: article.cached,
          chars: article.charCount,
          truncated: article.truncated,
        },
      });
      return reply.send(article);
    } catch (err: unknown) {
      serverLog(
        "error",
        "radar",
        `radar-article 失败: ${(err as Error)?.message}`,
        {
          meta: {
            storyId,
            error: {
              name: (err as Error)?.name,
              message: (err as Error)?.message,
            },
          },
        },
      );
      return sendError(reply, err);
    }
  });
}
