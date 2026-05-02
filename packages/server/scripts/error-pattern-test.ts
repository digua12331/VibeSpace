// Unit-style smoke for ErrorPatternMonitor.
// Run via: pnpm smoke:error-pattern (which delegates to tsx in the server package).

import { ErrorPatternMonitor, __test__ } from "../src/error-pattern-monitor.ts";
import type { ErrorPatternAlert, LogEntry } from "../src/types/log.ts";

let failures = 0;
let total = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  total += 1;
  if (cond) {
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}\n`);
    if (detail !== undefined) {
      process.stdout.write(`        ${JSON.stringify(detail)}\n`);
    }
  }
}

let nextId = 1;
function makeError(opts: {
  scope: string;
  msg?: string;
  action?: string;
  projectId?: string;
  ts?: number;
}): LogEntry {
  return {
    id: nextId++,
    ts: opts.ts ?? Date.now(),
    level: "error",
    scope: opts.scope,
    projectId: opts.projectId,
    msg: opts.msg ?? "boom",
    meta: opts.action ? { action: opts.action } : undefined,
  };
}

function runScenario(name: string, fn: () => void) {
  process.stdout.write(`\n[scenario] ${name}\n`);
  fn();
}

// ---- 1. 3 同 key error 在窗口内触发 1 次告警 ----

runScenario("3 same-key errors trip exactly one alert", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 1_000_000_000_000;
  m.now = () => t0;
  m.record(makeError({ scope: "fs", action: "write", projectId: "p1", ts: t0 }));
  check("after 1 error → no alert", alerts.length === 0);
  m.record(makeError({ scope: "fs", action: "write", projectId: "p1", ts: t0 + 1000 }));
  check("after 2 errors → no alert", alerts.length === 0);
  m.record(makeError({ scope: "fs", action: "write", projectId: "p1", ts: t0 + 2000 }));
  check("after 3 errors → exactly 1 alert", alerts.length === 1, alerts);
  if (alerts.length === 1) {
    check("alert.count === 3", alerts[0].count === 3);
    check("alert.key.scope/action/projectId correct",
      alerts[0].key.scope === "fs" && alerts[0].key.action === "write" && alerts[0].key.projectId === "p1");
    check("alert.key.actionIsFallback === false (real action)", alerts[0].key.actionIsFallback === false);
    check("alert.firstAt and lastAt span the window",
      alerts[0].firstAt === t0 && alerts[0].lastAt === t0 + 2000);
  }
});

// ---- 2. 不同 projectId 不误聚合 ----

runScenario("same scope/action but different projectId → no cross-aggregation", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 2_000_000_000_000;
  m.now = () => t0;
  m.record(makeError({ scope: "fs", action: "write", projectId: "pA", ts: t0 }));
  m.record(makeError({ scope: "fs", action: "write", projectId: "pB", ts: t0 + 100 }));
  m.record(makeError({ scope: "fs", action: "write", projectId: "pA", ts: t0 + 200 }));
  m.record(makeError({ scope: "fs", action: "write", projectId: "pB", ts: t0 + 300 }));
  check("after 2 errors per project → still no alerts", alerts.length === 0);
  m.record(makeError({ scope: "fs", action: "write", projectId: "pA", ts: t0 + 400 }));
  check("3rd error on pA → 1 alert for pA", alerts.length === 1 && alerts[0].key.projectId === "pA");
  m.record(makeError({ scope: "fs", action: "write", projectId: "pB", ts: t0 + 500 }));
  check("3rd error on pB → 2 alerts total, second is pB",
    alerts.length === 2 && alerts[1].key.projectId === "pB");
});

// ---- 3. 冷却期内不重复告警 ----

runScenario("cooldown suppresses repeats in the same window", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 3_000_000_000_000;
  m.record(makeError({ scope: "fs", action: "x", ts: t0 }));
  m.record(makeError({ scope: "fs", action: "x", ts: t0 + 1 }));
  m.record(makeError({ scope: "fs", action: "x", ts: t0 + 2 }));
  check("baseline trigger fires", alerts.length === 1);
  // Pile on more errors well within cooldown — should NOT trigger again.
  for (let i = 0; i < 50; i += 1) {
    m.record(makeError({ scope: "fs", action: "x", ts: t0 + 100 + i }));
  }
  check("50 follow-up errors during cooldown → still 1 alert", alerts.length === 1);
  // Jump past the cooldown — next error keeps adding to the window, but the
  // sliding window also expires the very early entries. Send 3 fresh ones.
  const past = t0 + __test__.COOLDOWN_MS + 1;
  m.record(makeError({ scope: "fs", action: "x", ts: past }));
  m.record(makeError({ scope: "fs", action: "x", ts: past + 1 }));
  m.record(makeError({ scope: "fs", action: "x", ts: past + 2 }));
  check("after cooldown expires + threshold met → 2 alerts total", alerts.length === 2);
});

// ---- 4. 缺 action 用 hash fallback，相同 msg 形成稳定 key ----

runScenario("missing action → hash fallback forms stable key", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 4_000_000_000_000;
  m.record(makeError({ scope: "git", msg: "EBUSY: resource busy or locked", ts: t0 }));
  m.record(makeError({ scope: "git", msg: "EBUSY: resource busy or locked", ts: t0 + 1 }));
  m.record(makeError({ scope: "git", msg: "EBUSY: resource busy or locked", ts: t0 + 2 }));
  check("3 actionless same-msg errors → 1 alert", alerts.length === 1);
  if (alerts.length === 1) {
    check("alert.key.actionIsFallback === true", alerts[0].key.actionIsFallback === true);
    check("fallback action is a short hex string",
      /^[0-9a-f]{8}$/.test(alerts[0].key.action), alerts[0].key.action);
  }
});

// ---- 5. 不同 msg 不聚合 (fallback hash 必须区分) ----

runScenario("different actionless messages → independent buckets", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 5_000_000_000_000;
  // Two errors of msg A, two of msg B — should not trigger.
  m.record(makeError({ scope: "git", msg: "AAAA", ts: t0 }));
  m.record(makeError({ scope: "git", msg: "AAAA", ts: t0 + 1 }));
  m.record(makeError({ scope: "git", msg: "BBBB", ts: t0 + 2 }));
  m.record(makeError({ scope: "git", msg: "BBBB", ts: t0 + 3 }));
  check("2 of each msg → no alert", alerts.length === 0);
  // Now push msg A over the threshold.
  m.record(makeError({ scope: "git", msg: "AAAA", ts: t0 + 4 }));
  check("3rd AAAA → 1 alert just for AAAA bucket", alerts.length === 1);
  if (alerts.length === 1) {
    check("alert.sampleMsg === AAAA", alerts[0].sampleMsg === "AAAA");
  }
});

// ---- 6. 滑动窗外的旧时间戳被惰性清理 ----

runScenario("sliding window drops timestamps older than WINDOW_MS", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 6_000_000_000_000;
  // Two errors way in the past — should be evicted.
  m.record(makeError({ scope: "fs", action: "y", ts: t0 - __test__.WINDOW_MS - 1000 }));
  m.record(makeError({ scope: "fs", action: "y", ts: t0 - __test__.WINDOW_MS - 500 }));
  // Now two recent ones — total inside window is 2 → should NOT trigger.
  m.record(makeError({ scope: "fs", action: "y", ts: t0 }));
  m.record(makeError({ scope: "fs", action: "y", ts: t0 + 1 }));
  check("expired timestamps purged, only 2 in window → no alert", alerts.length === 0);
  // One more recent → 3 inside window → alert.
  m.record(makeError({ scope: "fs", action: "y", ts: t0 + 2 }));
  check("3rd recent error → 1 alert", alerts.length === 1);
  if (alerts.length === 1) {
    check("alert.count reflects window-only count (3, not 5)", alerts[0].count === 3, alerts[0]);
  }
});

// ---- 7. 非 error 等级被忽略 ----

runScenario("non-error levels are ignored", () => {
  const m = new ErrorPatternMonitor();
  const alerts: ErrorPatternAlert[] = [];
  m.subscribe((a) => alerts.push(a));
  const t0 = 7_000_000_000_000;
  for (let i = 0; i < 10; i += 1) {
    const e = makeError({ scope: "fs", action: "z", ts: t0 + i });
    e.level = i % 2 === 0 ? "info" : "warn";
    m.record(e);
  }
  check("10 info/warn entries → no alert", alerts.length === 0);
});

// ---- 8. 抛异常的订阅者不影响其他订阅者 ----

runScenario("a misbehaving subscriber does not break others", () => {
  const m = new ErrorPatternMonitor();
  const goodCalls: ErrorPatternAlert[] = [];
  m.subscribe(() => { throw new Error("boom from listener"); });
  m.subscribe((a) => goodCalls.push(a));
  const t0 = 8_000_000_000_000;
  m.record(makeError({ scope: "fs", action: "q", ts: t0 }));
  m.record(makeError({ scope: "fs", action: "q", ts: t0 + 1 }));
  m.record(makeError({ scope: "fs", action: "q", ts: t0 + 2 }));
  check("good subscriber still receives alert despite sibling throwing",
    goodCalls.length === 1, goodCalls);
});

process.stdout.write(`\n[error-pattern] ${total - failures}/${total} passed\n`);
if (failures > 0) process.exit(1);
