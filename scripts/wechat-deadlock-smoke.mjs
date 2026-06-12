/**
 * 微信单飞锁逃生口冒烟：断言纯判定逻辑（isCancelWord / classifyPendingGate）。
 * 这两个函数是入站闸口的决策核心，单测它们即覆盖"逃生指令识别 + 三道放行/拒绝"，
 * 无需 mock PTY / 微信 / 状态机整套单例。
 *
 * 先 `pnpm -F @aimon/server build`，再 node scripts/wechat-deadlock-smoke.mjs。
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, "..", "packages", "server", "dist", "wechat", "inbound.js");
if (!existsSync(dist)) {
  console.error("FAIL: 先跑 pnpm -F @aimon/server build（缺 dist/wechat/inbound.js）");
  process.exit(1);
}
const { isCancelWord, classifyPendingGate } = await import(`file://${dist.replace(/\\/g, "/")}`);

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const GRACE = 8000;
const TTL = 10 * 60 * 1000;

console.log("[1] 逃生指令识别");
for (const w of ["取消", "重置", "解锁", "清空", "/cancel", "/reset", "/clear", "  取消  "]) {
  check(`"${w.trim()}" 识别为解锁`, isCancelWord(w));
}
check('"取消订阅项目" 不误判', !isCancelWord("取消订阅项目"));
check('"现在有几个项目" 不误判', !isCancelWord("现在有几个项目"));

console.log("[2] 闸口判定：拒绝（AI 真在生成）");
check("working + 新鲜 → reject", classifyPendingGate({ ageMs: 1000, hubStatus: "working" }) === "reject");
check("working + 超宽限 → reject（在干活不放）", classifyPendingGate({ ageMs: GRACE + 5000, hubStatus: "working" }) === "reject");
check("idle 但未过宽限 → reject（防瞬时 idle 误判）", classifyPendingGate({ ageMs: GRACE - 2000, hubStatus: "idle" }) === "reject");

console.log("[3] 闸口判定：孤儿放行（答完没回传）");
check("idle + 超宽限 → orphan", classifyPendingGate({ ageMs: GRACE + 1000, hubStatus: "idle" }) === "orphan");
check("waiting_input + 超宽限 → orphan", classifyPendingGate({ ageMs: GRACE + 1000, hubStatus: "waiting_input" }) === "orphan");
check("会话已不在(undefined) + 超宽限 → orphan", classifyPendingGate({ ageMs: GRACE + 1000, hubStatus: undefined }) === "orphan");

console.log("[4] 闸口判定：超时兜底");
check("超 TTL → ttl（优先于一切）", classifyPendingGate({ ageMs: TTL + 1000, hubStatus: "working" }) === "ttl");

if (failures > 0) {
  console.error(`\nwechat-deadlock smoke: ${failures} 项失败`);
  process.exit(1);
}
console.log("\nwechat-deadlock smoke: 全部通过");
