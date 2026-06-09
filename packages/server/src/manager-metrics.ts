/**
 * 「经理 AI 受约束派工」战绩指标(N2.3 价值闸门)。
 *
 * 用最简持久计数器回答一个问题:**经理 AI 到底有没有替大哥省时间**?
 * 这是 roadmap 钉死的闸门——这三个数不好看,就不该往第三版起的自主化推进。
 *
 * 计数(per-project,落盘 data/manager-metrics.json,原子写,重启不丢):
 *   - batches      : 用户点「派工」的次数(一次点击 = 一批)
 *   - dispatched   : 实际起跑的子任务数(一批可能跑多个 + 自动推进后续波)
 *   - merged       : 合并成功的子任务数
 *   - rejected     : 被 reject(丢弃 worktree)的子任务数 —— 返工信号
 *   - dangerBlocked: 被危险边界硬拦的子任务数
 *   - mergeConflict: 合并冲突数
 *
 * 派生(在前端算,见 DocsView 战绩面板):
 *   - 省手     ≈ dispatched - batches(点 batches 次,系统替你跑了 dispatched 个)
 *   - 一次通过率 = merged / (merged + rejected + dangerBlocked + mergeConflict)
 *   - 返工率   = rejected / max(1, dispatched)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, "..", "data");
const METRICS_PATH = resolve(DATA_DIR, "manager-metrics.json");

export interface ManagerMetricsCounters {
  batches: number;
  dispatched: number;
  merged: number;
  rejected: number;
  dangerBlocked: number;
  mergeConflict: number;
  updatedAt: number | null;
}

export type ManagerMetricField = Exclude<keyof ManagerMetricsCounters, "updatedAt">;

function zero(): ManagerMetricsCounters {
  return {
    batches: 0,
    dispatched: 0,
    merged: 0,
    rejected: 0,
    dangerBlocked: 0,
    mergeConflict: 0,
    updatedAt: null,
  };
}

type Store = Record<string, ManagerMetricsCounters>;

function readStore(): Store {
  if (!existsSync(METRICS_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(METRICS_PATH, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    return raw as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${METRICS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  renameSync(tmp, METRICS_PATH);
}

export function getManagerMetrics(projectId: string): ManagerMetricsCounters {
  const store = readStore();
  return { ...zero(), ...(store[projectId] ?? {}) };
}

/** 给某项目的某个计数 +n(默认 +1)。原子读改写。 */
export function bumpManagerMetric(
  projectId: string,
  field: ManagerMetricField,
  n = 1,
): void {
  const store = readStore();
  const cur = { ...zero(), ...(store[projectId] ?? {}) };
  cur[field] = (cur[field] ?? 0) + n;
  cur.updatedAt = Date.now();
  store[projectId] = cur;
  writeStore(store);
}
