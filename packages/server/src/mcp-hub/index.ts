#!/usr/bin/env node
/**
 * aimon-mcp-hub —— stdio MCP server for the VibeSpace 总控台 (Hub).
 *
 * Spawned by claude / codex CLIs when a hub session starts: the CLI reads
 * `data/hub-workspace/.mcp.json` (written by hub-session-runtime each time
 * a hub session boots) and launches us as a stdio child.  Lifecycle = client
 * controlled: CLI exits → SIGPIPE → we exit too.
 *
 * Tools (white-listed read + dispatch only — see Codex review D9):
 *   - hub_status            self-check
 *   - list_projects         → [{id, name, path}]
 *   - get_project_sessions  → [{id, agent, status, lastActivityAt, memBytes}]
 *   - read_git_log          → recent commits
 *   - read_file             → project file content (size/binary/path guarded)
 *   - dispatch_to_project   → create a new session and send `text` as first line
 *
 * Errors are returned via MCP's `isError: true` content + an embedded
 * structured payload so hub claude can branch on `code` programmatically.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HUB_TOKEN = process.env.HUB_TOKEN ?? "";
const BACKEND_PORT = Number(process.env.AIMON_BACKEND_PORT || 8787);
const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`;

interface StructuredError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

function errorResult(err: StructuredError) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(err, null, 2),
      },
    ],
  };
}

function okResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

interface HttpFailure {
  status: number;
  bodyText: string;
  parsed?: { error?: string; message?: string; detail?: unknown };
}

async function hubFetch(
  pathAndQuery: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: unknown } | { ok: false; failure: HttpFailure }> {
  const headers = new Headers(init.headers ?? {});
  headers.set("X-Hub-Token", HUB_TOKEN);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`${BACKEND_BASE}${pathAndQuery}`, { ...init, headers });
  } catch (err) {
    return {
      ok: false,
      failure: {
        status: 0,
        bodyText: (err as Error).message,
      },
    };
  }
  const bodyText = await res.text();
  let parsed: HttpFailure["parsed"];
  try {
    parsed = bodyText ? (JSON.parse(bodyText) as HttpFailure["parsed"]) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    return { ok: false, failure: { status: res.status, bodyText, parsed } };
  }
  return { ok: true, data: parsed ?? bodyText };
}

function failureToStructured(f: HttpFailure): StructuredError {
  if (f.status === 0) {
    return {
      code: "backend_unreachable",
      message: `Cannot reach VibeSpace backend at ${BACKEND_BASE} — is the server running?`,
      retryable: true,
      details: { reason: f.bodyText },
    };
  }
  if (f.status === 401) {
    return {
      code: "unauthorized",
      message: "HUB_TOKEN rejected by VibeSpace backend (server may have restarted; restart hub session to pick up the new token).",
      retryable: false,
    };
  }
  const code = f.parsed?.error ?? `http_${f.status}`;
  const message = f.parsed?.message
    ?? (typeof f.parsed?.detail === "string" ? (f.parsed.detail as string) : f.bodyText)
    ?? `HTTP ${f.status}`;
  return {
    code,
    message,
    retryable: f.status >= 500,
    details: f.parsed,
  };
}

const server = new McpServer(
  {
    name: "aimon-mcp-hub",
    version: "0.1.0",
  },
  {
    capabilities: { tools: {} },
  },
);

// -------- 1. hub_status -------------------------------------------------

server.registerTool(
  "hub_status",
  {
    title: "Hub status",
    description:
      "Self-check: confirms VibeSpace server is reachable and HUB_TOKEN matches. Use this if other tools fail to diagnose whether the backend is up.",
    inputSchema: {},
  },
  async () => {
    const r = await hubFetch("/api/hub/status");
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    const data = r.data as { projects: unknown[] };
    return okResult({
      server_ok: true,
      backend: BACKEND_BASE,
      projects_count: Array.isArray(data.projects) ? data.projects.length : 0,
    });
  },
);

// -------- 2. list_projects ---------------------------------------------

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "List all VibeSpace projects (id, name, absolute path).",
    inputSchema: {},
  },
  async () => {
    const r = await hubFetch("/api/hub/status");
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    const data = r.data as { projects: Array<{ id: string; name: string; path: string }> };
    return okResult(
      data.projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    );
  },
);

// -------- 3. get_project_sessions --------------------------------------

const ProjectIdSchema = { projectId: z.string().min(1).describe("VibeSpace project id (from list_projects)") };

server.registerTool(
  "get_project_sessions",
  {
    title: "Get project sessions",
    description: "Get all alive AI sessions in a project (excludes raw shells).",
    inputSchema: ProjectIdSchema,
  },
  async ({ projectId }) => {
    const r = await hubFetch("/api/hub/status");
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    const data = r.data as {
      projects: Array<{
        id: string;
        sessions: Array<{
          id: string;
          agent: string;
          status: string;
          startedAt: number;
          lastInputAt: number | null;
          lastOutputAt: number | null;
        }>;
        totalMemBytes: number;
      }>;
    };
    const proj = data.projects.find((p) => p.id === projectId);
    if (!proj) {
      return errorResult({
        code: "project_not_found",
        message: `No project with id "${projectId}". Use list_projects to see available ids.`,
        retryable: false,
      });
    }
    return okResult(
      proj.sessions.map((s) => ({
        id: s.id,
        agent: s.agent,
        status: s.status,
        startedAt: s.startedAt,
        lastInputAt: s.lastInputAt,
        lastOutputAt: s.lastOutputAt,
      })),
    );
  },
);

// -------- 4. read_git_log ----------------------------------------------

server.registerTool(
  "read_git_log",
  {
    title: "Read git log",
    description: "Recent commits in a project (subject + author + date + short sha).",
    inputSchema: {
      projectId: z.string().min(1).describe("VibeSpace project id"),
      n: z.number().int().min(1).max(50).default(10).describe("How many commits (1–50)"),
    },
  },
  async ({ projectId, n }) => {
    const r = await hubFetch(
      `/api/hub/projects/${encodeURIComponent(projectId)}/git-log?n=${n}`,
    );
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 5. read_file -------------------------------------------------

server.registerTool(
  "read_file",
  {
    title: "Read project file",
    description:
      "Read a text file inside a project (relative path). Refuses absolute paths, paths escaping the project root, files > 1 MB, and binary files.",
    inputSchema: {
      projectId: z.string().min(1).describe("VibeSpace project id"),
      path: z
        .string()
        .min(1)
        .describe("Path relative to project root (e.g. 'README.md' or 'src/index.ts')"),
    },
  },
  async ({ projectId, path }) => {
    const r = await hubFetch(
      `/api/hub/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`,
    );
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 6. read_session_output --------------------------------------

server.registerTool(
  "read_session_output",
  {
    title: "Read session output",
    description:
      "Read the last N lines of a session's terminal output (works for any session — hub, project, AI or shell). Use this after dispatch_to_project to see what the new session is doing, or to check on an existing session you were told about.",
    inputSchema: {
      sessionId: z.string().min(1).describe("Session id (from get_project_sessions or dispatch_to_project)"),
      lines: z.number().int().min(1).max(1000).default(200).describe("Tail length in lines (1-1000)"),
    },
  },
  async ({ sessionId, lines }) => {
    const r = await hubFetch(
      `/api/hub/sessions/${encodeURIComponent(sessionId)}/recent-output?lines=${lines}`,
    );
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 7. dispatch_to_idle_session ----------------------------------

server.registerTool(
  "dispatch_to_idle_session",
  {
    title: "Dispatch task to existing IDLE session",
    description:
      "Reuse an existing claude session that is currently idle (its previous task has finished) instead of creating a new one. Strict preconditions: target must be a claude agent (not codex/shell), PTY must be alive, status must be 'idle' for ≥ 800ms, no human input within the last 1000ms, and the session must not already be locked by another hub dispatch. On rejection you get a structured error code (not_idle / idle_too_fresh / waiting_input / recently_typed / not_ai_session / no_live_pty / locked / session_not_found) — typically you should then call dispatch_to_project to create a fresh session instead.",
    inputSchema: {
      sessionId: z.string().min(1).describe("Target session id (from get_project_sessions; must be a claude session in 'idle' state)"),
      text: z.string().min(1).max(20_000).describe("Task instruction to send (control characters stripped server-side; trailing \\r appended automatically)"),
    },
  },
  async ({ sessionId, text }) => {
    const r = await hubFetch("/api/hub/dispatch-to-idle-session", {
      method: "POST",
      body: JSON.stringify({ targetSessionId: sessionId, text }),
    });
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 8. dispatch_to_project ---------------------------------------

server.registerTool(
  "dispatch_to_project",
  {
    title: "Dispatch task to project",
    description:
      "Create a NEW AI session in the target project and send `text` as its first line. Does NOT dispatch to existing sessions (their PTY state is unknown and would be disrupted). Agent is restricted to claude / codex.",
    inputSchema: {
      projectId: z.string().min(1).describe("Target project id"),
      agent: z.enum(["claude", "codex"]).describe("Which AI CLI to spawn"),
      text: z
        .string()
        .min(1)
        .max(20_000)
        .describe("Task instruction sent as the first input to the new session"),
    },
  },
  async ({ projectId, agent, text }) => {
    const r = await hubFetch("/api/hub/dispatch", {
      method: "POST",
      body: JSON.stringify({ targetProjectId: projectId, agent, text }),
    });
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 9. send_feishu_message ---------------------------------------

server.registerTool(
  "send_feishu_message",
  {
    title: "Send a message to the owner on Feishu",
    description:
      "Proactively send a plain-text message to the owner (大哥) on Feishu. Use this whenever you need to talk to the owner, ask them a question, request a decision, or report that work is done — do NOT rely on them watching your terminal. The message goes to the open_id configured in the Feishu settings. Fails if the bridge isn't configured or the owner open_id is unset.",
    inputSchema: {
      text: z
        .string()
        .min(1)
        .max(8000)
        .describe("Plain text to send to the owner on Feishu (control chars stripped server-side)"),
    },
  },
  async ({ text }) => {
    const r = await hubFetch("/api/hub/send-feishu-message", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 10. send_wechat_reply -----------------------------------------

server.registerTool(
  "send_wechat_reply",
  {
    title: "Reply to the owner's WeChat question",
    description:
      "Reply to a question the owner asked via WeChat. When your input starts with a [微信 requestId=xxx] prefix, the owner is asking from WeChat — after finishing the work, call this tool with that exact requestId and your answer so it reaches their WeChat chat. One question at a time: the requestId is only valid until answered. Plain text only, keep it concise (WeChat chat bubble). This does NOT support proactive messages — it can only answer the pending request.",
    inputSchema: {
      requestId: z
        .string()
        .min(1)
        .max(64)
        .describe("The requestId from the [微信 requestId=xxx] prefix of the owner's message"),
      text: z
        .string()
        .min(1)
        .max(8000)
        .describe("Plain-text answer to send back to the owner's WeChat (control chars stripped server-side)"),
    },
  },
  async ({ requestId, text }) => {
    const r = await hubFetch("/api/hub/send-wechat-reply", {
      method: "POST",
      body: JSON.stringify({ requestId, text }),
    });
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- 11. send_input_to_session ------------------------------------

server.registerTool(
  "send_input_to_session",
  {
    title: "Answer a worker that is waiting for input",
    description:
      "On the owner's behalf, write one line of input into a worker session that is currently WAITING for input (e.g. claude/codex asking a yes/no or a choice). Strict preconditions enforced server-side: target must be an AI session (not shell), not the hub itself, PTY must be alive, status MUST be 'waiting_input', no human web input within the last 1000ms, and not already locked. Use ONLY when the owner told you to reply to a specific task (e.g.「回复任务X：继续」). On rejection you get a structured error (session_not_found / cannot_target_hub / not_ai_session / no_live_pty / not_waiting_input / recently_typed / locked).",
    inputSchema: {
      sessionId: z.string().min(1).describe("Target worker session id (from get_project_sessions; must be in 'waiting_input')"),
      text: z.string().min(1).max(20_000).describe("The line to send as the worker's answer (control chars stripped; trailing \\r appended automatically)"),
    },
  },
  async ({ sessionId, text }) => {
    const r = await hubFetch("/api/hub/send-input-to-session", {
      method: "POST",
      body: JSON.stringify({ sessionId, text }),
    });
    if (!r.ok) return errorResult(failureToStructured(r.failure));
    return okResult(r.data);
  },
);

// -------- main ---------------------------------------------------------

async function main(): Promise<void> {
  if (!HUB_TOKEN) {
    // Don't abort — start anyway so hub claude can call hub_status and see a
    // clear error, rather than the CLI failing to launch with no diagnosis.
    process.stderr.write(
      "aimon-mcp-hub: warning — HUB_TOKEN env not set; backend calls will be rejected\n",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`aimon-mcp-hub fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
