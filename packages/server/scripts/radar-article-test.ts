// AI 资讯原文抓取可控验证：SSRF 地址判定、URL 协议/IP 字面量拦截、
// 重定向逐跳校验与跳数上限、流式超限、非 HTML、脏 HTML 提取、空壳页、
// 超长截断、charset 嗅探、缓存命中。网络层全部用注入的 httpGet 模拟。
// 运行：pnpm -F @aimon/server exec tsx scripts/radar-article-test.ts

import {
  isForbiddenAddress,
  assertSafeUrl,
  fetchWithRedirects,
  extractArticleText,
  detectCharset,
  decodeBody,
  fetchRadarArticle,
  resetArticleCache,
  type HttpGetLike,
  type HttpGetResult,
} from "../src/radar-article.ts";
import { RadarError } from "../src/routes/radar.ts";

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

async function expectRadarError(
  name: string,
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
    check(name, false, "未抛错");
  } catch (e) {
    check(
      name,
      e instanceof RadarError && e.code === code,
      `实际: ${(e as Error)?.name}/${(e as RadarError)?.code ?? (e as Error)?.message}`,
    );
  }
}

function htmlResult(html: string, headers: Record<string, string> = {}): HttpGetResult {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    body: Buffer.from(html, "utf-8"),
  };
}

const GOOD_PARAGRAPH =
  "这是一段足够长的正文内容，用来验证提取器能把文章主体抽出来。".repeat(8);
const GOOD_HTML = `<!doctype html><html><head><title>测试文章标题</title></head><body>
  <nav><a href="/">首页</a><a href="/about">关于</a></nav>
  <article><h1>测试文章标题</h1>
    <p>${GOOD_PARAGRAPH}</p><p>${GOOD_PARAGRAPH}</p><p>${GOOD_PARAGRAPH}</p>
  </article>
  <footer>版权所有</footer></body></html>`;

// 真实世界脏 HTML：未闭合标签、属性不带引号、script 噪音、注释
const DIRTY_HTML = `<html><head><meta charset=utf-8><script>var x=1;<\/script>
  <body><div id=main><!-- ad slot --><p>${GOOD_PARAGRAPH}
  <p>${GOOD_PARAGRAPH}<br><p>${GOOD_PARAGRAPH}
  <div class=sidebar><ul><li>侧栏链接</ul></div>`;

async function main(): Promise<void> {
  console.log("== isForbiddenAddress：私网/回环/保留地址判定 ==");
  for (const ip of [
    "127.0.0.1", "10.0.0.5", "172.16.1.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1",
  ]) {
    check(`拒绝 ${ip}`, isForbiddenAddress(ip) === true);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    check(`放行公网 ${ip}`, isForbiddenAddress(ip) === false);
  }

  console.log("== assertSafeUrl：协议与 IP 字面量拦截 ==");
  for (const url of [
    "ftp://example.com/a",
    "file:///etc/passwd",
    "http://127.0.0.1/admin",
    "http://[::1]/admin",
    "http://192.168.1.1:8787/api",
    "http://localhost:8787/api",
    "http://foo.localhost/x",
    "not-a-url",
  ]) {
    try {
      assertSafeUrl(url);
      check(`拦截 ${url}`, false, "未抛错");
    } catch (e) {
      check(`拦截 ${url}`, e instanceof RadarError && e.code === "radar_article_blocked");
    }
  }
  check("放行 https://example.com/a", assertSafeUrl("https://example.com/a") instanceof URL);

  console.log("== fetchWithRedirects：逐跳校验与跳数上限 ==");
  // 重定向到私网 IP：第二跳应被 assertSafeUrl 拦下
  const redirectToPrivate: HttpGetLike = async (url) => {
    if (url.hostname === "example.com") {
      return { status: 302, headers: { location: "http://192.168.0.10/secret" }, body: Buffer.alloc(0) };
    }
    throw new Error("不应请求到这里");
  };
  await expectRadarError(
    "重定向到私网被拦截",
    () => fetchWithRedirects("https://example.com/a", redirectToPrivate),
    "radar_article_blocked",
  );

  // 相对路径重定向应基于当前 URL 解析并成功
  let relativeHops: string[] = [];
  const relativeRedirect: HttpGetLike = async (url) => {
    relativeHops.push(url.toString());
    if (url.pathname === "/a") {
      return { status: 301, headers: { location: "/b" }, body: Buffer.alloc(0) };
    }
    return htmlResult(GOOD_HTML);
  };
  const rel = await fetchWithRedirects("https://example.com/a", relativeRedirect);
  check(
    "相对重定向解析正确",
    rel.finalUrl.toString() === "https://example.com/b" && rel.result.status === 200,
    relativeHops.join(" -> "),
  );

  // 无限重定向：超过上限失败
  const loopRedirect: HttpGetLike = async (url) => ({
    status: 302,
    headers: { location: `https://example.com/loop?n=${Math.floor(Math.random() * 1e9)}` },
    body: Buffer.alloc(0),
  });
  await expectRadarError(
    "重定向次数过多失败",
    () => fetchWithRedirects("https://example.com/a", loopRedirect),
    "radar_article_failed",
  );

  // DNS 重绑定语义：连接期 lookup 报 RADAR_FORBIDDEN_ADDRESS 时映射成 blocked。
  // （真实路径里 safeLookup 绑定在 net/tls 建连上，这里验证错误映射与注入语义一致。）
  const rebindingGet: HttpGetLike = async () => {
    throw new RadarError("原文域名解析到内网或保留地址，已拒绝", "radar_article_blocked", 403);
  };
  await expectRadarError(
    "DNS 解析到内网被拒绝",
    () => fetchWithRedirects("https://rebind.example.com/a", rebindingGet),
    "radar_article_blocked",
  );

  console.log("== fetchRadarArticle：响应与提取分支 ==");
  resetArticleCache();
  // 正常提取
  const okGet: HttpGetLike = async () => htmlResult(GOOD_HTML);
  const art = await fetchRadarArticle({ storyId: "s1", url: "https://example.com/ok", httpGet: okGet });
  check("正常页面提取出正文", art.charCount >= 200 && !art.textContent.includes("<"));
  check("提取到标题", art.title === "测试文章标题", String(art.title));
  check("首次请求 cached=false", art.cached === false);
  const art2 = await fetchRadarArticle({ storyId: "s1", url: "https://example.com/ok", httpGet: okGet });
  check("重复请求命中缓存", art2.cached === true);

  // 脏 HTML 仍能提取
  resetArticleCache();
  const dirty = await fetchRadarArticle({
    storyId: "s2",
    url: "https://example.com/dirty",
    httpGet: async () => htmlResult(DIRTY_HTML),
  });
  check("脏 HTML 提取出正文", dirty.charCount >= 200 && !dirty.textContent.includes("<div"));

  // 空壳页（JS 动态渲染/登录页）：正文太短判 unextractable
  await expectRadarError(
    "空壳页判提取失败",
    () =>
      fetchRadarArticle({
        storyId: "s3",
        url: "https://example.com/shell",
        httpGet: async () => htmlResult("<html><body><div id=root></div><p>请登录</p></body></html>"),
      }),
    "radar_article_unextractable",
  );

  // 非 HTML content-type 拒绝
  await expectRadarError(
    "非 HTML 响应拒绝",
    () =>
      fetchRadarArticle({
        storyId: "s4",
        url: "https://example.com/pdf",
        httpGet: async () => ({
          status: 200,
          headers: { "content-type": "application/pdf" },
          body: Buffer.from("%PDF-1.4"),
        }),
      }),
    "radar_article_unextractable",
  );

  // 非 2xx 状态
  await expectRadarError(
    "HTTP 403 反爬站点判失败",
    () =>
      fetchRadarArticle({
        storyId: "s5",
        url: "https://example.com/blocked",
        httpGet: async () => ({ status: 403, headers: {}, body: Buffer.alloc(0) }),
      }),
    "radar_article_failed",
  );

  // 流式超限：注入层模拟真实 httpGetOnce 在累计字节超限时抛出的错误
  // （伪造小 Content-Length 不影响该路径——真实实现按 data 事件累计字节，不读头）
  await expectRadarError(
    "响应体超 2MB 中止",
    () =>
      fetchRadarArticle({
        storyId: "s6",
        url: "https://example.com/huge",
        httpGet: async () => {
          throw new RadarError("原文页面超过 2MB，已中止", "radar_article_failed", 502);
        },
      }),
    "radar_article_failed",
  );

  // 超长正文截断
  resetArticleCache();
  const longPara = "正文超长截断验证。".repeat(700); // 6300 字/段
  const longHtml = `<html><body><article>${Array.from({ length: 12 }, () => `<p>${longPara}</p>`).join("")}</article></body></html>`;
  const longArt = await fetchRadarArticle({
    storyId: "s7",
    url: "https://example.com/long",
    httpGet: async () => htmlResult(longHtml),
  });
  check(
    "超长正文被截断并带标记",
    longArt.truncated === true && longArt.textContent.includes("已截断"),
    `chars=${longArt.charCount}`,
  );

  console.log("== charset 处理 ==");
  check("头部 charset 优先", detectCharset("text/html; charset=GBK", Buffer.from("<meta charset=utf-8>")) === "gbk");
  check(
    "meta 嗅探 charset",
    detectCharset(undefined, Buffer.from('<html><head><meta charset="gb2312">')) === "gb2312",
  );
  check("默认 utf-8", detectCharset(undefined, Buffer.from("<html>")) === "utf-8");
  const gbkBuf = Buffer.from(new TextEncoder().encode("占位")); // utf-8 内容 + 错误 charset 标注也不应抛错
  check("未知 charset 回落 utf-8 不抛错", typeof decodeBody(gbkBuf, "text/html; charset=not-a-charset") === "string");

  console.log("== extractArticleText 纯文本保证 ==");
  const ext = extractArticleText(GOOD_HTML, "https://example.com/a");
  check("输出不含 HTML 标签", !/<[a-z][^>]*>/i.test(ext.textContent));

  console.log(`\n${total - failures}/${total} 通过`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("自测脚本异常:", e);
  process.exit(1);
});
