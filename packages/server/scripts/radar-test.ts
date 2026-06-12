// AI 资讯雷达可控验证：归一化、坏结构、缓存命中、force 绕缓存、超时、
// 非 200。全部用注入的 fetchImpl 模拟，不依赖真实上游故障。
// 运行：pnpm -F @aimon/server exec tsx scripts/radar-test.ts

import {
  RadarError,
  fetchDailyBrief,
  normalizeDailyBrief,
  resetRadarCache,
} from "../src/routes/radar.ts";

let failures = 0;
let total = 0;

function check(name: string, ok: boolean, detail?: string): void {
  total += 1;
  if (ok) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function okJson(payload: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
}

const VALID = {
  generated_at: "2026-06-12T00:00:00Z",
  items: [
    {
      story_id: "s1",
      title: "标题一",
      primary_url: "https://example.com/a",
      url: "https://example.com/a2",
      category: "model",
      importance_label: "高",
      score: 9.5,
      reasons: ["理由A", 42, "理由B"],
      source_count: 2,
      earliest_at: "2026-06-11T00:00:00Z",
      latest_at: "2026-06-11T12:00:00Z",
      sources: [
        { title: "src1", url: "https://example.com/s1", source_name: "S1", published_at: "2026-06-11T00:00:00Z" },
        { title: "src2", url: "javascript:alert(1)", source_name: "S2" },
        { url: "https://no-title.example.com" },
      ],
    },
    { title: "无ID故事", url: "ftp://bad.example.com" },
    { reasons: ["没有标题，应被跳过"] },
    "not-an-object",
  ],
};

// ---------- normalizeDailyBrief ----------
console.log("normalizeDailyBrief:");
{
  const r = normalizeDailyBrief(VALID);
  check("有效载荷解析", r.generatedAt === "2026-06-12T00:00:00Z" && r.items.length === 2);
  const s1 = r.items[0];
  check("primary_url 优先", s1.primaryUrl === "https://example.com/a");
  check("非字符串 reason 被滤掉", s1.reasons.length === 2);
  check("非 http(s) 来源链接置空", s1.sources[1].url === null);
  check("无标题来源被跳过", s1.sources.length === 2);
  const s2 = r.items[1];
  check("story_id 缺失时合成稳定键", s2.storyId.startsWith("synthetic:"));
  check("非 http(s) 原文链接置空", s2.primaryUrl === null);
}
{
  const r = normalizeDailyBrief({ generated_at: 123, items: "not-array" });
  check("items 非数组回落空数组", r.items.length === 0 && r.generatedAt === null);
}
for (const bad of [null, [], "str", 42]) {
  try {
    normalizeDailyBrief(bad);
    check(`整体结构损坏抛错 (${JSON.stringify(bad)})`, false);
  } catch (e) {
    check(
      `整体结构损坏抛错 (${JSON.stringify(bad)})`,
      e instanceof RadarError && e.code === "radar_invalid_payload" && e.httpStatus === 502,
    );
  }
}

// ---------- 缓存 / force ----------
console.log("fetchDailyBrief 缓存:");
{
  resetRadarCache();
  let calls = 0;
  const counting = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => VALID };
  };
  const a = await fetchDailyBrief({ fetchImpl: counting, force: false });
  const b = await fetchDailyBrief({ fetchImpl: counting, force: false });
  check("首次未命中缓存", a.cached === false && a.items.length === 2);
  check("二次命中缓存", b.cached === true && calls === 1);
  const c = await fetchDailyBrief({ fetchImpl: counting, force: true });
  check("force=1 绕过缓存", c.cached === false && calls === 2);
  // TTL 过期：把时钟拨快 11 分钟
  const later = Date.now() + 11 * 60 * 1000;
  const d = await fetchDailyBrief({ fetchImpl: counting, force: false, now: () => later });
  check("TTL 过期后重新拉取", d.cached === false && calls === 3);
}

// ---------- 失败分支 ----------
console.log("fetchDailyBrief 失败分支:");
{
  resetRadarCache();
  try {
    await fetchDailyBrief({ force: true, fetchImpl: okJson(null) as never });
    check("上游坏结构 → radar_invalid_payload", false);
  } catch (e) {
    check(
      "上游坏结构 → radar_invalid_payload",
      e instanceof RadarError && e.code === "radar_invalid_payload",
    );
  }
  try {
    await fetchDailyBrief({
      force: true,
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    check("上游 503 → radar_upstream_failed/502", false);
  } catch (e) {
    check(
      "上游 503 → radar_upstream_failed/502",
      e instanceof RadarError && e.code === "radar_upstream_failed" && e.httpStatus === 502,
    );
  }
  try {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    await fetchDailyBrief({
      force: true,
      fetchImpl: async () => {
        throw abortErr;
      },
    });
    check("超时(AbortError) → radar_upstream_timeout/504", false);
  } catch (e) {
    check(
      "超时(AbortError) → radar_upstream_timeout/504",
      e instanceof RadarError && e.code === "radar_upstream_timeout" && e.httpStatus === 504,
    );
  }
  try {
    await fetchDailyBrief({
      force: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bad json");
        },
      }),
    });
    check("非 JSON 响应 → radar_invalid_payload", false);
  } catch (e) {
    check(
      "非 JSON 响应 → radar_invalid_payload",
      e instanceof RadarError && e.code === "radar_invalid_payload",
    );
  }
  // 失败不污染缓存：失败后一次正常请求仍走真实拉取
  const ok = await fetchDailyBrief({ force: false, fetchImpl: okJson(VALID) });
  check("失败不写缓存，后续正常拉取", ok.cached === false && ok.items.length === 2);
}

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
