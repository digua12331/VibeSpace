/**
 * MCP server visibility + per-project toggle for a given project.
 *
 * Sources of truth:
 *  - **Global MCP**: `~/.claude.json.mcpServers`  (set up by `claude mcp add` or
 *    by editing the file directly). Currently: codegraph.
 *  - **Project MCP**: `<projectPath>/.mcp.json.mcpServers`  (auto-injected by
 *    `mcp-bridge.ts` for browser-use; users may also hand-add). Currently:
 *    browser-use.
 *  - **Per-project disable**: `~/.claude.json.projects.<absPath>.disabledMcpServers`
 *    (string[]) — the official mechanism for shutting down an MCP server for a
 *    single project (CLI `claude mcp disable` is still pending upstream).
 *
 * Routes:
 *  - GET  /api/mcp-servers?projectId=X
 *      Returns combined list with `enabled` resolved against the disable array.
 *  - PUT  /api/mcp-servers/toggle   { projectId, name, enabled }
 *      Writes the disable array. When toggling OFF, also runs
 *      `removeFromMcpJson(projectPath, name)` so the next session won't see a
 *      stale auto-injected entry. When toggling ON, just removes from the
 *      disable array — mcp-bridge will re-inject project MCP on next spawn.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getDisabledMcpServersForProject,
  getGlobalMcpServers,
  setDisabledMcpServersForProject,
} from "../claude-json-service.js";
import { removeFromMcpJson, writeBrowserUseToMcpJson } from "../mcp-bridge.js";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";

interface McpServerEntryOut {
  name: string;
  scope: "global" | "project";
  enabled: boolean;
  command?: string;
  args?: string[];
}

const NAME = z.string().min(1).max(200, "name 长度超出 200，疑似异常输入");

const ToggleBody = z.object({
  projectId: z.string().min(1).max(200),
  name: NAME,
  enabled: z.boolean(),
});

async function readProjectMcpServers(
  projectPath: string,
): Promise<Record<string, { command?: string; args?: string[] }>> {
  const target = join(projectPath, ".mcp.json");
  try {
    const raw = await readFile(target, "utf8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ms = parsed.mcpServers;
    if (!ms || typeof ms !== "object" || Array.isArray(ms)) return {};
    const out: Record<string, { command?: string; args?: string[] }> = {};
    for (const [k, v] of Object.entries(ms)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const row = v as Record<string, unknown>;
        out[k] = {
          command: typeof row.command === "string" ? row.command : undefined,
          args: Array.isArray(row.args)
            ? row.args.filter((a): a is string => typeof a === "string")
            : undefined,
        };
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    // Corrupt JSON: hide rather than fail the whole list call.
    return {};
  }
}

function buildList(
  globalMcp: Record<string, { command?: string; args?: string[] }>,
  projectMcp: Record<string, { command?: string; args?: string[] }>,
  disabled: string[],
): McpServerEntryOut[] {
  const disabledSet = new Set(disabled);
  const out: McpServerEntryOut[] = [];
  for (const [name, def] of Object.entries(globalMcp)) {
    out.push({
      name,
      scope: "global",
      enabled: !disabledSet.has(name),
      command: def.command,
      args: def.args,
    });
  }
  for (const [name, def] of Object.entries(projectMcp)) {
    // If a name appears in both global and project, surface both (Claude Code
    // disambiguates by scope; we want the UI to mirror disk truth).
    out.push({
      name,
      scope: "project",
      enabled: !disabledSet.has(name),
      command: def.command,
      args: def.args,
    });
  }
  // browser-use is a known optional project-scope MCP. Sessions no longer
  // auto-inject it, so when it's absent from disk we still surface an OFF row
  // (from the catalog) — otherwise the user couldn't turn it on from the panel.
  // Skip when already present in either source to avoid a duplicate row; a
  // present-but-disabled entry is already rendered OFF by the loops above.
  if (!("browser-use" in globalMcp) && !("browser-use" in projectMcp)) {
    out.push({
      name: "browser-use",
      scope: "project",
      enabled: false,
      command: "uvx",
      args: ["--from", "browser-use[cli]", "browser-use", "--mcp"],
    });
  }
  out.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export async function registerMcpServersRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Querystring: { projectId?: string } }>(
    "/api/mcp-servers",
    async (req, reply) => {
      const projectId = (req.query.projectId ?? "").trim();
      if (!projectId) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: "projectId 必填" });
      }
      const proj = getProject(projectId);
      if (!proj) {
        return reply
          .code(404)
          .send({ error: "project_not_found", detail: projectId });
      }
      try {
        const globalMcp = getGlobalMcpServers();
        const projectMcp = await readProjectMcpServers(proj.path);
        const disabled = getDisabledMcpServersForProject(proj.path);
        return reply.send({
          servers: buildList(globalMcp, projectMcp, disabled),
          disabled,
          projectPath: proj.path.replace(/\\/g, "/"),
        });
      } catch (err) {
        const e = err as Error;
        serverLog("error", "mcp-toggle", `list 失败: ${e.message}`, {
          projectId,
          meta: { error: { name: e.name, message: e.message, stack: e.stack } },
        });
        return reply
          .code(500)
          .send({ error: "mcp_servers_list_failed", message: e.message });
      }
    },
  );

  app.put<{ Body: unknown }>("/api/mcp-servers/toggle", async (req, reply) => {
    const parsed = ToggleBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { projectId, name, enabled } = parsed.data;
    const proj = getProject(projectId);
    if (!proj) {
      return reply
        .code(404)
        .send({ error: "project_not_found", detail: projectId });
    }
    const startedAt = Date.now();
    serverLog("info", "mcp-toggle", "toggle 开始", {
      projectId,
      meta: { name, nextEnabled: enabled, projectPath: proj.path.replace(/\\/g, "/") },
    });
    try {
      const cur = getDisabledMcpServersForProject(proj.path);
      const set = new Set(cur);
      if (enabled) {
        set.delete(name);
      } else {
        set.add(name);
      }
      setDisabledMcpServersForProject(proj.path, [...set]);

      let staleRemoved = false;
      let injected = false;
      if (enabled) {
        // Toggling ON: sessions no longer auto-inject browser-use, so enabling
        // a project-scope server must actively write it into <proj>/.mcp.json.
        // (Global servers like codegraph just need the disable marker cleared.)
        if (name === "browser-use") {
          const r = await writeBrowserUseToMcpJson(proj.path);
          injected = r.changed;
        }
      } else {
        // Toggling OFF: also clean any entry from <proj>/.mcp.json so the next
        // Claude session won't see a stale config.
        const r = await removeFromMcpJson(proj.path, name);
        staleRemoved = r.changed;
      }

      serverLog(
        "info",
        "mcp-toggle",
        `toggle 成功 (${Date.now() - startedAt}ms)`,
        {
          projectId,
          meta: {
            name,
            nextEnabled: enabled,
            disabledCount: set.size,
            staleRemoved,
            injected,
            ms: Date.now() - startedAt,
          },
        },
      );

      // Return refreshed list so the UI doesn't need a second GET.
      const globalMcp = getGlobalMcpServers();
      const projectMcp = await readProjectMcpServers(proj.path);
      const disabled = getDisabledMcpServersForProject(proj.path);
      return reply.send({
        servers: buildList(globalMcp, projectMcp, disabled),
        disabled,
        projectPath: proj.path.replace(/\\/g, "/"),
        staleRemoved,
      });
    } catch (err) {
      const e = err as Error;
      serverLog("error", "mcp-toggle", `toggle 失败: ${e.message}`, {
        projectId,
        meta: {
          name,
          nextEnabled: enabled,
          ms: Date.now() - startedAt,
          error: { name: e.name, message: e.message, stack: e.stack },
        },
      });
      return reply
        .code(500)
        .send({ error: "mcp_toggle_failed", message: e.message });
    }
  });
}
