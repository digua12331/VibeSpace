/**
 * agent-team 装配冒烟：验证通用团队（team-*）随工作流装配的四条生命周期路径
 *   1) 首次安装  2) 重复应用（幂等）  3) 升级（原样落后→刷新；用户改过→不动）
 *   4) 卸载（只删原样件 + legacy vibespace-* 清理 + 用户文件保留）
 * 以及模板内容安全断言（无项目专属假设、含大脑加载协议）。
 *
 * 直接 import server 构建产物，需要先 `pnpm -F @aimon/server build`。
 * 用法：node scripts/agent-team-smoke.mjs   （或 pnpm smoke:agent-team）
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const dist = join(REPO, "packages", "server", "dist", "harness-template-service.js");
if (!existsSync(dist)) {
  console.error("FAIL: 先跑 pnpm -F @aimon/server build（缺 dist/harness-template-service.js）");
  process.exit(1);
}
const svc = await import(`file://${dist.replace(/\\/g, "/")}`);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const read = (p) => readFileSync(p, "utf8");
// 与 harness-template-service.ts 的指纹算法保持一致（独立实现，互为校验）
const fpOf = (body) => createHash("sha256").update(body, "utf8").digest("hex").slice(0, 12);
const stampLine = (body) => `<!-- aimon-team-agent v=1 fp=${fpOf(body)} -->\n`;

const proj = mkdtempSync(join(tmpdir(), "agent-team-smoke-"));
const TEAM_AGENTS = ["team-explorer.md", "team-implementer.md", "team-verifier.md", "team-rules-auditor.md"];
const agentPath = (n) => join(proj, ".claude", "agents", n);
const usagePath = join(proj, ".aimon", "docs", "team-usage.md");

try {
  // ---------- 1) 首次安装 ----------
  console.log("[1] 首次安装");
  const r1 = await svc.applyHarnessTemplate(proj);
  for (const n of TEAM_AGENTS) check(`${n} 已装`, existsSync(agentPath(n)));
  check("team-usage.md 落 .aimon/docs/", existsSync(usagePath));
  check(
    "copied 含 4 个 team agent",
    r1.copied.filter((p) => p.startsWith(".claude/agents/team-")).length === 4,
  );
  const forbidden = /vibespace-|fastify|react|packages\/server|packages\/web|logAction|serverLog|emerald|zustand/i;
  for (const n of [...TEAM_AGENTS]) {
    const body = read(agentPath(n));
    check(`${n} 无项目专属假设`, !forbidden.test(body));
    check(`${n} 含大脑加载协议`, body.includes("大脑加载协议"));
    check(`${n} 带指纹标记`, /<!-- aimon-team-agent v=1 fp=[0-9a-f]{12} -->\s*$/.test(body));
  }
  check("不再错拷 vibespace-* 专属 agent", !existsSync(agentPath("vibespace-explorer.md")));

  // ---------- 2) 重复应用（幂等） ----------
  console.log("[2] 重复应用");
  const before = read(agentPath("team-explorer.md"));
  const r2 = await svc.applyHarnessTemplate(proj);
  check(
    "team 文件全部 skipped",
    r2.copied.filter((p) => p.includes("team-")).length === 0,
  );
  check("内容不变", read(agentPath("team-explorer.md")) === before);

  // ---------- 3) 升级 ----------
  console.log("[3] 升级");
  // 3a 用户改过（正文动了、标记还在）→ 不刷新
  const modified = read(agentPath("team-explorer.md")).replace("调研员", "改造过的调研员");
  writeFileSync(agentPath("team-explorer.md"), modified, "utf8");
  await svc.applyHarnessTemplate(proj);
  check("用户改过的不被覆盖", read(agentPath("team-explorer.md")) === modified);
  // 3b 原样旧版（伪造旧母版内容 + 自洽指纹）→ 刷新为当前母版
  const oldBody = "---\nname: team-verifier\ndescription: old\ntools: Read\n---\n旧版正文\n";
  writeFileSync(agentPath("team-verifier.md"), oldBody + stampLine(oldBody), "utf8");
  const r3 = await svc.applyHarnessTemplate(proj);
  check("原样旧版被刷新", r3.copied.includes(".claude/agents/team-verifier.md"));
  check("刷新后含协议段", read(agentPath("team-verifier.md")).includes("大脑加载协议"));
  // 3c 同名无标记用户文件 → 不动
  const userOwn = "---\nname: team-rules-auditor\n---\n我自己写的审稿员\n";
  writeFileSync(agentPath("team-rules-auditor.md"), userOwn, "utf8");
  await svc.applyHarnessTemplate(proj);
  check("无标记同名文件不被覆盖", read(agentPath("team-rules-auditor.md")) === userOwn);
  // 状态探测：原样=未改造(renamed=false)，改过/无标记=已改造(renamed=true)
  const st = await svc.getHarnessStatus(proj);
  const entry = (rel) => st.entries.find((e) => e.relPath === rel);
  check("status: 原样件 renamed=false", entry(".claude/agents/team-implementer.md")?.renamed === false);
  check("status: 改造件 renamed=true", entry(".claude/agents/team-explorer.md")?.renamed === true);

  // ---------- 4) 卸载 ----------
  console.log("[4] 卸载");
  // 布景：legacy 原件（含 vibespace- 字面量）/ legacy 已改造件 / 用户自建文件
  writeFileSync(agentPath("vibespace-explorer.md"), "# vibespace-explorer 旧拷贝\n", "utf8");
  writeFileSync(agentPath("vibespace-db-scribe.md"), "# 用户重写过，无原前缀字样\n", "utf8");
  writeFileSync(agentPath("my-agent.md"), "# 用户自建\n", "utf8");
  const r4 = await svc.uninstallHarnessTemplate(proj);
  check("原样 team 件被删", !existsSync(agentPath("team-implementer.md")) && !existsSync(usagePath));
  check("改过的 team 件保留", existsSync(agentPath("team-explorer.md")));
  check("无标记同名用户件保留", existsSync(agentPath("team-rules-auditor.md")));
  check("legacy 原件被清", !existsSync(agentPath("vibespace-explorer.md")));
  check("legacy 改造件保留", existsSync(agentPath("vibespace-db-scribe.md")));
  check("用户自建文件保留", existsSync(agentPath("my-agent.md")));
  check("返回 teamAgentsRemoved>0（日志 meta 数据源）", r4.teamAgentsRemoved >= 2, String(r4.teamAgentsRemoved));
  check("返回 legacyCleaned 名单", r4.legacyCleaned.includes(".claude/agents/vibespace-explorer.md"));

  // ---------- REPO_ROOT 防护（只验判定，不真跑仓库根卸载） ----------
  console.log("[5] 母版防护");
  // 真实卸载 REPO_ROOT 太危险，这里验证清单源仍在 + 防护代码存在（静态检查）
  const svcSrc = read(join(REPO, "packages", "server", "src", "harness-template-service.ts"));
  check("uninstall 含 REPO_ROOT 跳过防护", svcSrc.includes("resolve(projectPath) !== REPO_ROOT"));
  for (const n of TEAM_AGENTS) check(`母版 ${n} 仍在`, existsSync(join(REPO, "templates", "agent-team", n)));
} finally {
  rmSync(proj, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nagent-team smoke: ${failures} 项失败`);
  process.exit(1);
}
console.log("\nagent-team smoke: 全部通过");
