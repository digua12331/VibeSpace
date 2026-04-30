import type { FastifyInstance } from "fastify";
import { getSession } from "../db.js";
import { subagentRuns, type SubagentRunRecord } from "../subagent-runs.js";

/** Wire shape: prompt is truncated server-side. */
interface WireSubagentRun {
  id: string;
  parentSessionId: string;
  subagentType: string;
  description: string;
  prompt: string;
  promptTruncated: boolean;
  state: SubagentRunRecord["state"];
  startedAt: number;
  endedAt: number | null;
}

const PROMPT_WIRE_LIMIT = 1024;

function serialize(r: SubagentRunRecord): WireSubagentRun {
  const truncated = r.prompt.length > PROMPT_WIRE_LIMIT;
  return {
    id: r.id,
    parentSessionId: r.parentSessionId,
    subagentType: r.subagentType,
    description: r.description,
    prompt: truncated ? r.prompt.slice(0, PROMPT_WIRE_LIMIT) : r.prompt,
    promptTruncated: truncated,
    state: r.state,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

export async function registerSubagentRunsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/subagent-runs",
    async (req, reply) => {
      const { id } = req.params;
      // Tolerate session-not-found: the hook may register runs against a
      // session row that the UI later removes; return empty rather than 404.
      const exists = !!getSession(id);
      if (!exists) return [];
      return subagentRuns.list(id).map(serialize);
    },
  );
}
