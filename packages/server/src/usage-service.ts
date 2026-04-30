import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ModelFamily = "opus" | "sonnet" | "haiku" | "other";

export interface UsageByModel {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface UsageBucket {
  total: UsageByModel;
  byModel: Record<ModelFamily, UsageByModel>;
}

export interface UsageDayPoint {
  date: string;
  totalTokens: number;
}

export interface ClaudeUsage {
  today: UsageBucket;
  last5h: UsageBucket & { windowStartMs: number; windowEndMs: number };
  last7days: UsageDayPoint[];
  skipped: number;
  filesScanned: number;
  entriesScanned: number;
  asOf: number;
  note?: string;
}

const ZERO: UsageByModel = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

function emptyBucket(): UsageBucket {
  return {
    total: { ...ZERO },
    byModel: {
      opus: { ...ZERO },
      sonnet: { ...ZERO },
      haiku: { ...ZERO },
      other: { ...ZERO },
    },
  };
}

function classifyModel(model: string | undefined): ModelFamily {
  if (!model) return "other";
  const m = /^claude-(opus|sonnet|haiku)-/i.exec(model);
  if (!m) return "other";
  return m[1].toLowerCase() as ModelFamily;
}

function addInto(bucket: UsageBucket, family: ModelFamily, u: UsageByModel): void {
  const t = bucket.total;
  t.inputTokens += u.inputTokens;
  t.outputTokens += u.outputTokens;
  t.cacheCreationTokens += u.cacheCreationTokens;
  t.cacheReadTokens += u.cacheReadTokens;
  const m = bucket.byModel[family];
  m.inputTokens += u.inputTokens;
  m.outputTokens += u.outputTokens;
  m.cacheCreationTokens += u.cacheCreationTokens;
  m.cacheReadTokens += u.cacheReadTokens;
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function startOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function projectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

async function listJsonlFiles(): Promise<string[]> {
  const root = projectsRoot();
  let topDirs: string[];
  try {
    topDirs = await readdir(root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw err;
  }
  const files: string[] = [];
  for (const dir of topDirs) {
    const sub = join(root, dir);
    let entries: string[];
    try {
      entries = await readdir(sub);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.endsWith(".jsonl")) files.push(join(sub, name));
    }
  }
  return files;
}

interface ParsedRow {
  tsMs: number;
  family: ModelFamily;
  usage: UsageByModel;
}

function parseLine(line: string): ParsedRow | null {
  if (!line) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  if (!Number.isFinite(ts)) return null;
  const msg = o.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== "object") return null;
  const usage = msg.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const model = typeof msg.model === "string" ? msg.model : undefined;
  const u: UsageByModel = {
    inputTokens: numOr0(usage.input_tokens),
    outputTokens: numOr0(usage.output_tokens),
    cacheCreationTokens: numOr0(usage.cache_creation_input_tokens),
    cacheReadTokens: numOr0(usage.cache_read_input_tokens),
  };
  if (
    u.inputTokens === 0 &&
    u.outputTokens === 0 &&
    u.cacheCreationTokens === 0 &&
    u.cacheReadTokens === 0
  ) {
    return null;
  }
  return { tsMs: ts, family: classifyModel(model), usage: u };
}

function numOr0(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

export async function computeClaudeUsage(now: number = Date.now()): Promise<ClaudeUsage> {
  const files = await listJsonlFiles();
  const today = emptyBucket();
  const last5h = emptyBucket();
  const todayStart = startOfTodayMs(now);
  const fiveHoursMs = 5 * 60 * 60 * 1000;
  const fiveHourStart = now - fiveHoursMs;
  const sevenDayStart = startOfTodayMs(now) - 6 * 24 * 60 * 60 * 1000;
  const dayBuckets = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) {
    dayBuckets.set(dayKey(sevenDayStart + i * 24 * 60 * 60 * 1000), 0);
  }
  let skipped = 0;
  let entriesScanned = 0;
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      skipped += 1;
      continue;
    }
    const lines = raw.split("\n");
    for (const line of lines) {
      if (!line) continue;
      const row = parseLine(line);
      if (!row) {
        skipped += 1;
        continue;
      }
      entriesScanned += 1;
      if (row.tsMs >= todayStart) addInto(today, row.family, row.usage);
      if (row.tsMs >= fiveHourStart) addInto(last5h, row.family, row.usage);
      if (row.tsMs >= sevenDayStart) {
        const key = dayKey(row.tsMs);
        const cur = dayBuckets.get(key);
        if (cur !== undefined) {
          dayBuckets.set(
            key,
            cur +
              row.usage.inputTokens +
              row.usage.outputTokens +
              row.usage.cacheCreationTokens +
              row.usage.cacheReadTokens,
          );
        }
      }
    }
  }
  const last7days: UsageDayPoint[] = [];
  for (let i = 0; i < 7; i += 1) {
    const key = dayKey(sevenDayStart + i * 24 * 60 * 60 * 1000);
    last7days.push({ date: key, totalTokens: dayBuckets.get(key) ?? 0 });
  }
  return {
    today,
    last5h: { ...last5h, windowStartMs: fiveHourStart, windowEndMs: now },
    last7days,
    skipped,
    filesScanned: files.length,
    entriesScanned,
    asOf: now,
    note: files.length === 0 ? "no jsonl found" : undefined,
  };
}
