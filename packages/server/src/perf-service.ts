import pidusage from "pidusage";
import { ptyManager } from "./pty-manager.js";
import { listSessionsByProject } from "./db.js";
import type { Agent } from "./db.js";

export interface SessionPerfSample {
  sessionId: string;
  agent: Agent;
  pid: number | null;
  cpu: number;
  memRss: number;
  sampledAt: number;
  error?: string;
}

export interface ProjectPerf {
  projectId: string;
  sessions: SessionPerfSample[];
  totalCpu: number;
  totalRssBytes: number;
  sampledAt: number;
}

interface CacheEntry {
  sample: SessionPerfSample;
  ts: number;
}

const CACHE_TTL_MS = 1000;
const cache = new Map<string, CacheEntry>();

/**
 * Lazily sample the CPU / RSS of every alive PTY session belonging to `projectId`.
 * Uses a 1-second cache so rapid polls (e.g. two web clients each on a 2-second
 * interval) don't hammer `pidusage`. Sessions that belong to the project in the
 * DB but aren't alive in the PTY manager are filtered out.
 */
export async function sampleProject(projectId: string): Promise<ProjectPerf> {
  const now = Date.now();
  const dbSessions = listSessionsByProject(projectId).filter(
    (s) => s.endedAt == null && ptyManager.isAlive(s.id),
  );

  const needSample: Array<{ id: string; agent: Agent; pid: number }> = [];
  const samples: SessionPerfSample[] = [];

  for (const s of dbSessions) {
    const pid = ptyManager.getPid(s.id);
    const cached = cache.get(s.id);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      samples.push(cached.sample);
      continue;
    }
    if (pid == null) {
      samples.push({
        sessionId: s.id,
        agent: s.agent,
        pid: null,
        cpu: 0,
        memRss: 0,
        sampledAt: now,
        error: "pid_gone",
      });
      continue;
    }
    needSample.push({ id: s.id, agent: s.agent, pid });
  }

  if (needSample.length > 0) {
    const pids = needSample.map((n) => n.pid);
    let stats: Record<string, { cpu: number; memory: number } | null> = {};
    try {
      // pidusage accepts an array and returns a map keyed by pid string.
      stats = (await pidusage(pids)) as Record<
        string,
        { cpu: number; memory: number } | null
      >;
    } catch (err) {
      // Global failure: mark every requested sample with the error so the UI
      // shows "—" instead of silently zero.
      const msg = (err as Error)?.message ?? String(err);
      for (const n of needSample) {
        const sample: SessionPerfSample = {
          sessionId: n.id,
          agent: n.agent,
          pid: n.pid,
          cpu: 0,
          memRss: 0,
          sampledAt: now,
          error: msg,
        };
        cache.set(n.id, { sample, ts: now });
        samples.push(sample);
      }
      return finalize(projectId, samples, now);
    }
    for (const n of needSample) {
      const row = stats[String(n.pid)];
      const sample: SessionPerfSample = row
        ? {
            sessionId: n.id,
            agent: n.agent,
            pid: n.pid,
            cpu: row.cpu,
            memRss: row.memory,
            sampledAt: now,
          }
        : {
            sessionId: n.id,
            agent: n.agent,
            pid: n.pid,
            cpu: 0,
            memRss: 0,
            sampledAt: now,
            error: "no_stats",
          };
      cache.set(n.id, { sample, ts: now });
      samples.push(sample);
    }
  }

  // Drop cache entries that no longer correspond to alive sessions. Cheap
  // bookkeeping — keeps the map from growing forever across server lifetime.
  for (const id of cache.keys()) {
    if (!ptyManager.isAlive(id)) cache.delete(id);
  }

  return finalize(projectId, samples, now);
}

function finalize(
  projectId: string,
  samples: SessionPerfSample[],
  sampledAt: number,
): ProjectPerf {
  const totalCpu = samples.reduce((acc, s) => acc + (s.cpu || 0), 0);
  const totalRssBytes = samples.reduce((acc, s) => acc + (s.memRss || 0), 0);
  return {
    projectId,
    sessions: samples,
    totalCpu,
    totalRssBytes,
    sampledAt,
  };
}
