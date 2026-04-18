import type { FastifyInstance } from "fastify";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { getProject } from "../db.js";

// The core library lives outside the server package (shared with scripts/).
// Resolve it once at module init and reuse.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dev: packages/server/src/routes -> up 4 -> repo root
// prod: packages/server/dist/routes -> up 4 -> repo root
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const CORE_URL = pathToFileURL(
  resolve(REPO_ROOT, "scripts", "lib", "cli-configs-core.mjs"),
).href;

// Minimal shape of the dynamically-imported core. We don't ship types for it;
// just describe what we use.
interface ProbeFile {
  exists: boolean;
  size?: number;
  mtimeMs?: number;
  error?: string;
  parseError?: string;
}
interface ProbeResult {
  claudeDir: { exists: boolean };
  codexDir: { exists: boolean };
  claudeSettings: ProbeFile;
  claudeLocal: ProbeFile;
  codexConfig: ProbeFile;
}
interface CoreLib {
  loadCatalog(): unknown;
  copyClaudeTemplate(p: string, opts?: { force?: boolean; initLocal?: boolean }): string[];
  copyCodexTemplate(p: string, opts?: { force?: boolean }): string[];
  readClaudeLocal(p: string): { permissions: { allow: string[]; ask: string[]; deny: string[] } };
  readClaudeShared(p: string): { allow: string[]; ask: string[]; deny: string[] } | null;
  diffClaudeAgainstCatalog(catalog: unknown, local: unknown): {
    selections: Record<string, "allow" | "ask" | "deny" | "off">;
    custom: { allow: string[]; ask: string[]; deny: string[] };
  };
  writeClaudeLocal(
    p: string,
    catalog: unknown,
    selections: Record<string, string>,
    customOverride?: { allow: string[]; ask: string[]; deny: string[] },
  ): string;
  readCodexConfig(p: string, catalog: unknown): { values: Record<string, unknown>; managedPaths: string[] };
  writeCodexConfig(p: string, catalog: unknown, valuesByPath: Record<string, unknown>): string;
  probeProjectCliFiles(p: string): ProbeResult;
}

let coreCache: CoreLib | null = null;
async function core(): Promise<CoreLib> {
  if (!coreCache) {
    coreCache = (await import(CORE_URL)) as CoreLib;
  }
  return coreCache;
}

const TriState = z.enum(["allow", "ask", "deny", "off"]);

const ClaudeSaveSchema = z.object({
  selections: z.record(z.string(), TriState).default({}),
  custom: z
    .object({
      allow: z.array(z.string()).default([]),
      ask: z.array(z.string()).default([]),
      deny: z.array(z.string()).default([]),
    })
    .optional(),
});

const CodexSaveSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
});

const SaveSchema = z.object({
  claude: ClaudeSaveSchema.optional(),
  codex: CodexSaveSchema.optional(),
});

const InitSchema = z.object({
  variants: z.array(z.enum(["claude", "codex"])).min(1),
  force: z.boolean().optional(),
});

function validProjectOrFail(
  id: string,
): { ok: true; path: string } | { ok: false; status: number; error: string } {
  const proj = getProject(id);
  if (!proj) return { ok: false, status: 404, error: "project_not_found" };
  try {
    const st = statSync(proj.path);
    if (!st.isDirectory()) {
      return { ok: false, status: 400, error: "project_path_not_directory" };
    }
  } catch {
    return { ok: false, status: 400, error: "project_path_missing" };
  }
  return { ok: true, path: proj.path };
}

export async function registerCliConfigRoutes(app: FastifyInstance): Promise<void> {
  // Catalog (static, shared by all projects)
  app.get("/api/cli-configs/catalog", async () => {
    const c = await core();
    return c.loadCatalog();
  });

  // Read per-project state
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/cli-configs",
    async (req, reply) => {
      const v = validProjectOrFail(req.params.id);
      if (!v.ok) return reply.code(v.status).send({ error: v.error });
      const c = await core();
      const catalog = c.loadCatalog();
      const local = c.readClaudeLocal(v.path);
      const claude = c.diffClaudeAgainstCatalog(catalog, local);
      const codex = c.readCodexConfig(v.path, catalog);
      const probe = c.probeProjectCliFiles(v.path);
      let shared: ReturnType<CoreLib["readClaudeShared"]> = null;
      let sharedError: string | null = null;
      try {
        shared = c.readClaudeShared(v.path);
      } catch (err) {
        sharedError = (err as Error).message ?? String(err);
      }
      return {
        projectPath: v.path,
        probe,
        claude: {
          selections: claude.selections,
          custom: claude.custom,
          fileExists: probe.claudeLocal.exists,
          shared,
          sharedError,
        },
        codex: {
          values: codex.values,
          managedPaths: codex.managedPaths,
          fileExists: probe.codexConfig.exists,
        },
      };
    },
  );

  // Save per-project state
  app.put<{ Params: { id: string } }>(
    "/api/projects/:id/cli-configs",
    async (req, reply) => {
      const v = validProjectOrFail(req.params.id);
      if (!v.ok) return reply.code(v.status).send({ error: v.error });
      const parsed = SaveSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const c = await core();
      const catalog = c.loadCatalog();
      const written: string[] = [];
      if (parsed.data.claude) {
        const p = c.writeClaudeLocal(
          v.path,
          catalog,
          parsed.data.claude.selections,
          parsed.data.claude.custom,
        );
        written.push(p);
      }
      if (parsed.data.codex) {
        const p = c.writeCodexConfig(v.path, catalog, parsed.data.codex.values);
        written.push(p);
      }
      return { ok: true, written };
    },
  );

  // Init: copy template files into project dir
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/cli-configs/init",
    async (req, reply) => {
      const v = validProjectOrFail(req.params.id);
      if (!v.ok) return reply.code(v.status).send({ error: v.error });
      const parsed = InitSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const c = await core();
      const changed: string[] = [];
      if (parsed.data.variants.includes("claude")) {
        changed.push(
          ...c.copyClaudeTemplate(v.path, { force: parsed.data.force, initLocal: true }),
        );
      }
      if (parsed.data.variants.includes("codex")) {
        changed.push(...c.copyCodexTemplate(v.path, { force: parsed.data.force }));
      }
      return { ok: true, changed };
    },
  );
}
