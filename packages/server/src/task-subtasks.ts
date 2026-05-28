/**
 * Subtask graph parsing + topological ordering for "大任务自拆并行".
 *
 * Plan.md may end with a `## 自拆与依赖` heading followed by a fenced JSON
 * block that declares the subtasks and their dependencies. Example:
 *
 * ```json
 * {
 *   "schema_version": 1,
 *   "subtasks": [
 *     { "id": 1, "title": "...", "write_files": ["a.ts"], "depends_on": [] },
 *     { "id": 2, "title": "...", "write_files": ["b.ts"], "depends_on": [1] }
 *   ]
 * }
 * ```
 *
 * Why JSON not YAML: the project has no YAML dependency, and LLM output is
 * more reliable for JSON. See context.md decision D1.
 */

import { serverLog } from "./log-bus.js";

export interface SubtaskSpec {
  id: number;
  title: string;
  /** Files this subtask is allowed to write. Required; used for overlap detection. */
  write_files: string[];
  /** Hard dependencies (must merge before this one). */
  depends_on: number[];
}

export interface SubtaskGraph {
  schema_version: number;
  subtasks: SubtaskSpec[];
  /** Topological order (id-sequence). Filled by validateGraph. */
  order: number[];
  /**
   * Auto-added edges from write_files overlap detection. Each entry =
   * "we silently added depends_on b -> a because they wrote the same file".
   * Surfaced to the UI so the user knows the graph isn't exactly what they
   * wrote.
   */
  auto_edges: Array<{ from: number; to: number; reason: string }>;
}

export type ParseSubtasksResult =
  | { ok: true; graph: SubtaskGraph }
  | { ok: false; reason: ParseFailReason; detail?: string };

export type ParseFailReason =
  | "no-section"
  | "no-json-block"
  | "bad-json"
  | "bad-schema"
  | "cycle"
  | "duplicate-id"
  | "missing-dep";

const SECTION_HEADER = "## 自拆与依赖";
const JSON_FENCE = /```json\s*\n([\s\S]*?)\n\s*```/;

/**
 * Locate and parse the `## 自拆与依赖` JSON block in a plan.md. Returns the
 * fully-validated graph (with topo order + auto-edges resolved) on success.
 * Returns a failure reason on any parse / schema / cycle problem so the UI
 * can render an actionable error.
 */
export function parseSubtasksFromPlan(planMd: string): ParseSubtasksResult {
  const idx = planMd.indexOf(SECTION_HEADER);
  if (idx < 0) {
    return { ok: false, reason: "no-section" };
  }
  const tail = planMd.slice(idx);
  const m = tail.match(JSON_FENCE);
  if (!m) {
    return { ok: false, reason: "no-json-block" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch (err) {
    return {
      ok: false,
      reason: "bad-json",
      detail: (err as Error).message,
    };
  }
  const schemaCheck = validateSchema(parsed);
  if (!schemaCheck.ok) {
    return { ok: false, reason: "bad-schema", detail: schemaCheck.detail };
  }
  const graphCheck = validateGraph(schemaCheck.subtasks, schemaCheck.schema_version);
  if (!graphCheck.ok) {
    return graphCheck;
  }
  return { ok: true, graph: graphCheck.graph };
}

interface SchemaCheckOk {
  ok: true;
  schema_version: number;
  subtasks: SubtaskSpec[];
}
interface SchemaCheckFail {
  ok: false;
  detail: string;
}

function validateSchema(input: unknown): SchemaCheckOk | SchemaCheckFail {
  if (!input || typeof input !== "object") {
    return { ok: false, detail: "not an object" };
  }
  const obj = input as Record<string, unknown>;
  const schema_version =
    typeof obj.schema_version === "number" ? obj.schema_version : 1;
  const rawList = obj.subtasks;
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { ok: false, detail: "subtasks must be a non-empty array" };
  }
  const subtasks: SubtaskSpec[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return { ok: false, detail: `subtasks[${i}] not an object` };
    }
    if (typeof raw.id !== "number" || !Number.isInteger(raw.id) || raw.id < 1) {
      return {
        ok: false,
        detail: `subtasks[${i}].id must be a positive integer`,
      };
    }
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
      return { ok: false, detail: `subtasks[${i}].title required` };
    }
    if (!Array.isArray(raw.write_files) || raw.write_files.length === 0) {
      return {
        ok: false,
        detail: `subtasks[${i}].write_files must be a non-empty array`,
      };
    }
    const writeFiles: string[] = [];
    for (const wf of raw.write_files) {
      if (typeof wf !== "string" || wf.length === 0) {
        return {
          ok: false,
          detail: `subtasks[${i}].write_files contains non-string`,
        };
      }
      writeFiles.push(wf);
    }
    const dependsOn: number[] = [];
    if (raw.depends_on !== undefined) {
      if (!Array.isArray(raw.depends_on)) {
        return {
          ok: false,
          detail: `subtasks[${i}].depends_on must be an array`,
        };
      }
      for (const d of raw.depends_on) {
        if (typeof d !== "number" || !Number.isInteger(d) || d < 1) {
          return {
            ok: false,
            detail: `subtasks[${i}].depends_on contains non-id`,
          };
        }
        dependsOn.push(d);
      }
    }
    subtasks.push({
      id: raw.id,
      title: raw.title,
      write_files: writeFiles,
      depends_on: dependsOn,
    });
  }
  return { ok: true, schema_version, subtasks };
}

/**
 * Validate dependency graph: detect duplicate ids, missing-dep references,
 * write_files overlap (auto-add edges), and cycles. Returns the fully-resolved
 * graph with topo order on success.
 */
export function validateGraph(
  specs: SubtaskSpec[],
  schema_version: number = 1,
): ParseSubtasksResult {
  const ids = new Set<number>();
  for (const s of specs) {
    if (ids.has(s.id)) {
      return {
        ok: false,
        reason: "duplicate-id",
        detail: `id ${s.id} appears twice`,
      };
    }
    ids.add(s.id);
  }
  // Resolve missing deps before adding overlap edges.
  for (const s of specs) {
    for (const dep of s.depends_on) {
      if (!ids.has(dep)) {
        return {
          ok: false,
          reason: "missing-dep",
          detail: `subtask ${s.id} depends on missing id ${dep}`,
        };
      }
    }
  }
  // write_files overlap detection: for each pair (a, b) with a.id < b.id and
  // file intersection non-empty, add edge a -> b (b depends on a). Only when
  // not already declared.
  const auto_edges: Array<{ from: number; to: number; reason: string }> = [];
  const sorted = [...specs].sort((a, b) => a.id - b.id);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aSet = new Set(a.write_files);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const overlap = b.write_files.filter((f) => aSet.has(f));
      if (overlap.length === 0) continue;
      if (b.depends_on.includes(a.id)) continue;
      b.depends_on.push(a.id);
      auto_edges.push({
        from: a.id,
        to: b.id,
        reason: `write_files overlap: ${overlap.join(", ")}`,
      });
    }
  }
  // Topological sort (Kahn). Returns null on cycle.
  const order = topologicalOrder(specs);
  if (!order) {
    return {
      ok: false,
      reason: "cycle",
      detail: "dependency graph has at least one cycle",
    };
  }
  if (auto_edges.length > 0) {
    serverLog(
      "info",
      "subtasks",
      `auto-added ${auto_edges.length} edge(s) for write_files overlap`,
      { meta: { auto_edges } },
    );
  }
  return {
    ok: true,
    graph: { schema_version, subtasks: specs, order, auto_edges },
  };
}

/**
 * Kahn topological order — emits ids in dependency-respecting sequence.
 * Returns null when at least one cycle is present.
 */
export function topologicalOrder(specs: SubtaskSpec[]): number[] | null {
  const inDeg = new Map<number, number>();
  const outEdges = new Map<number, number[]>();
  for (const s of specs) {
    inDeg.set(s.id, s.depends_on.length);
    outEdges.set(s.id, []);
  }
  for (const s of specs) {
    for (const dep of s.depends_on) {
      outEdges.get(dep)!.push(s.id);
    }
  }
  const queue: number[] = [];
  for (const s of specs) {
    if ((inDeg.get(s.id) ?? 0) === 0) queue.push(s.id);
  }
  queue.sort((a, b) => a - b);
  const out: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of outEdges.get(id) ?? []) {
      const d = (inDeg.get(next) ?? 0) - 1;
      inDeg.set(next, d);
      if (d === 0) {
        // Insertion sort by id to keep order deterministic.
        let pos = queue.length;
        while (pos > 0 && queue[pos - 1] > next) pos -= 1;
        queue.splice(pos, 0, next);
      }
    }
  }
  if (out.length !== specs.length) return null;
  return out;
}

/**
 * Group topo-ordered ids into "waves" of independents that can run in parallel.
 * Wave N contains all nodes whose deepest dependency depth equals N.
 * Returns groups in order; each group can be dispatched concurrently.
 */
export function topologicalWaves(graph: SubtaskGraph): number[][] {
  const specById = new Map(graph.subtasks.map((s) => [s.id, s]));
  const depth = new Map<number, number>();
  for (const id of graph.order) {
    const s = specById.get(id)!;
    if (s.depends_on.length === 0) {
      depth.set(id, 0);
      continue;
    }
    const maxDep = Math.max(...s.depends_on.map((d) => depth.get(d) ?? 0));
    depth.set(id, maxDep + 1);
  }
  const waves: number[][] = [];
  for (const id of graph.order) {
    const d = depth.get(id) ?? 0;
    while (waves.length <= d) waves.push([]);
    waves[d].push(id);
  }
  return waves;
}
