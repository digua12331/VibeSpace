import type { FastifyInstance } from "fastify";
import { existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  createProject,
  deleteProject as dbDeleteProject,
  getProject,
  listProjects,
  listSessionsByProject,
  endSession,
  updateProjectLayout,
  updateProjectWorkflowMode,
  updateProjectStartScript,
  type WorkflowMode,
} from "../db.js";
import { ptyManager } from "../pty-manager.js";
import { cloneRepo, removeWorktree } from "../git-service.js";
import { serverLog } from "../log-bus.js";
import { HUB_PROJECT_ID } from "../hub-project.js";
import { listSkills } from "../skills-service.js";
import {
  applyWorkflowToProject,
  getWorkflowStatus,
  removeWorkflowFromProject,
  updateProjectDevDocs,
} from "../workflow-service.js";

const DEFAULT_ROOT = "F:\\VibeSpace";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  path: z.string().min(1).optional(),
  cloneUrl: z.string().trim().min(1).optional(),
});

/** Validate a clone URL: only http/https are allowed. SSH/file/scp-style and
 *  malformed strings are rejected (sanitizedGitEnv strips auth env so SSH can't
 *  work here, and file:// could read arbitrary local paths). Returns the
 *  hostname for redacted logging. */
function validateCloneUrl(raw: string): { url: string; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid_clone_url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_clone_url");
  }
  return { url: raw, host: parsed.host };
}

const LayoutSchema = z.object({
  cols: z.number().int().min(1).max(48),
  rowHeight: z.number().int().min(10).max(400),
  tiles: z.array(
    z.object({
      i: z.string().min(1),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
      minW: z.number().int().min(1).optional(),
      minH: z.number().int().min(1).optional(),
    }),
  ),
});

/** Workflow apply/remove body：mode 与 superpowers 都可省（默认 mode="dev-docs"，superpowers=false 兼容现有调用）。
 *  spec-trio 是 OpenSpec + Superpowers + gstack 预设套餐——选它时 superpowers 字段被忽略（强制装/卸）。 */
const WorkflowOptionsSchema = z
  .object({
    mode: z.enum(["dev-docs", "openspec", "spec-trio"]).optional(),
    superpowers: z.boolean().optional(),
  })
  .strict();

// 一键启动脚本：script 可为 null（清空）或一个 .bat/.cmd 路径（绝对或相对项目根）。
const StartScriptSchema = z.object({
  script: z.string().trim().min(1).max(1000).nullable(),
});

const BAT_RE = /\.(bat|cmd)$/i;

/** 把存储值（相对项目根或绝对）解析成绝对路径。 */
function resolveStartScript(projectPath: string, script: string): string {
  return isAbsolute(script) ? script : join(projectPath, script);
}

/** 落库归一：脚本落在项目目录内则存相对路径（forward-slash，跨设备/搬家友好），否则存绝对路径。 */
function normalizeStartScript(projectPath: string, script: string): string {
  const abs = resolveStartScript(projectPath, script);
  const rel = relative(projectPath, abs);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return rel.split(sep).join("/");
  }
  return abs;
}

/** 扫项目根目录一层，列出 .bat/.cmd 文件名（给「设置启动脚本」弹窗选）。目录不存在/读失败返回 []。 */
function listBatCandidates(projectPath: string): string[] {
  try {
    return readdirSync(projectPath, { withFileTypes: true })
      .filter((e) => e.isFile() && BAT_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/projects", async () => {
    return listProjects();
  });

  app.post("/api/projects", async (req, reply) => {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const { name, path: rawPath, cloneUrl } = parsed.data;
    const pathMode: "auto" | "custom" = rawPath ? "custom" : "auto";
    const path = rawPath ?? join(DEFAULT_ROOT, name);

    // --- Clone branch: when a git URL is supplied, download the repo into a
    // fresh target dir, then register it. Disk/dir semantics differ from the
    // empty-project path (target must NOT exist), so handle it separately and
    // leave the original flow below untouched. ---
    if (cloneUrl) {
      let cloneHost: string;
      let url: string;
      try {
        const v = validateCloneUrl(cloneUrl);
        url = v.url;
        cloneHost = v.host;
      } catch {
        serverLog("error", "project", "project-clone 失败: invalid_clone_url", {
          meta: { name, path, pathMode },
        });
        return reply.code(400).send({ error: "invalid_clone_url" });
      }

      // Fail fast before spending minutes cloning: target dir must not exist,
      // and its path must not already be registered.
      if (existsSync(path)) {
        serverLog("error", "project", "project-clone 失败: path_exists", {
          meta: { name, path, pathMode, cloneHost },
        });
        return reply.code(400).send({ error: "path_exists", path });
      }
      if (listProjects().some((p) => p.path === path)) {
        serverLog("error", "project", "project-clone 失败: path_already_exists", {
          meta: { name, path, pathMode, cloneHost },
        });
        return reply.code(409).send({ error: "path_already_exists", path });
      }

      const tClone = Date.now();
      serverLog("info", "project", "project-clone 开始", {
        meta: { name, path, pathMode, cloneHost },
      });

      try {
        await cloneRepo(url, path);
      } catch (err) {
        const msg = (err as Error).message || "clone failed";
        // Clean up only the dir this request created — it did not exist before
        // the pre-clone existsSync check above, so removing exactly `path` can
        // never touch a pre-existing user directory.
        if (existsSync(path)) {
          try {
            await rm(path, { recursive: true, force: true });
          } catch {
            /* best-effort cleanup */
          }
        }
        serverLog("error", "project", `project-clone 失败: ${msg}`, {
          meta: {
            name,
            path,
            pathMode,
            cloneHost,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return reply.code(400).send({ error: "clone_failed", detail: msg });
      }

      try {
        const proj = createProject({ id: nanoid(12), name, path });
        serverLog("info", "project", `project-clone 成功 (${Date.now() - tClone}ms)`, {
          projectId: proj.id,
          meta: { name, path, pathMode, cloneHost },
        });
        return reply.code(201).send(proj);
      } catch (err) {
        const msg = (err as Error).message || "";
        // DB write failed after a successful clone: drop the cloned dir so we
        // don't leave an orphan folder with no project record.
        if (existsSync(path)) {
          try {
            await rm(path, { recursive: true, force: true });
          } catch {
            /* best-effort cleanup */
          }
        }
        if (msg.includes("UNIQUE") || msg.includes("constraint")) {
          serverLog("error", "project", "project-clone 失败: path_already_exists", {
            meta: { name, path, pathMode, cloneHost },
          });
          return reply.code(409).send({ error: "path_already_exists", path });
        }
        serverLog("error", "project", `project-clone 失败: ${msg}`, {
          meta: {
            name,
            path,
            pathMode,
            cloneHost,
            error: { name: (err as Error).name, message: msg },
          },
        });
        throw err;
      }
    }

    const t0 = Date.now();
    serverLog("info", "project", "project-create 开始", {
      meta: { name, path, pathMode },
    });

    if (pathMode === "auto") {
      try {
        mkdirSync(path, { recursive: true });
      } catch (err) {
        const msg = (err as Error).message || "mkdir failed";
        serverLog("error", "project", `project-create 失败: ${msg}`, {
          meta: {
            name,
            path,
            pathMode,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return reply.code(400).send({ error: "path_unwritable", path });
      }
    } else {
      try {
        const st = statSync(path);
        if (!st.isDirectory()) {
          serverLog(
            "error",
            "project",
            "project-create 失败: path_not_directory",
            { meta: { name, path, pathMode } },
          );
          return reply.code(400).send({ error: "path_not_directory", path });
        }
      } catch {
        serverLog("error", "project", "project-create 失败: path_not_found", {
          meta: { name, path, pathMode },
        });
        return reply.code(400).send({ error: "path_not_found", path });
      }
    }

    try {
      const proj = createProject({ id: nanoid(12), name, path });
      serverLog(
        "info",
        "project",
        `project-create 成功 (${Date.now() - t0}ms)`,
        {
          projectId: proj.id,
          meta: { name, path, pathMode },
        },
      );
      return reply.code(201).send(proj);
    } catch (err) {
      const msg = (err as Error).message || "";
      if (msg.includes("UNIQUE") || msg.includes("constraint")) {
        serverLog(
          "error",
          "project",
          "project-create 失败: path_already_exists",
          { meta: { name, path, pathMode } },
        );
        return reply.code(409).send({ error: "path_already_exists", path });
      }
      serverLog("error", "project", `project-create 失败: ${msg}`, {
        meta: {
          name,
          path,
          pathMode,
          error: { name: (err as Error).name, message: msg },
        },
      });
      throw err;
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/workflow",
    async (req, reply) => {
      if (req.params.id === HUB_PROJECT_ID) {
        serverLog("warn", "hub", "拒绝 apply-workflow 到 __hub__", {
          projectId: HUB_PROJECT_ID,
        });
        return reply.code(400).send({ error: "hub_no_workflow" });
      }
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });

      // body 可省（兼容旧前端 POST without body）；存在时严格校验
      let opts: { mode?: WorkflowMode; superpowers?: boolean } = {};
      if (req.body !== undefined && req.body !== null) {
        const parsed = WorkflowOptionsSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: "invalid_body", detail: parsed.error.issues });
        }
        opts = parsed.data;
      }
      const mode = opts.mode ?? "dev-docs";
      const superpowers = opts.superpowers === true;

      const t0 = Date.now();
      serverLog("info", "project", "apply-workflow 开始", {
        projectId: proj.id,
        meta: { mode, superpowers },
      });
      try {
        const r = await applyWorkflowToProject(proj.path, { mode, superpowers });

        // 第一步规范工作流是否成功
        const specOk =
          (mode === "dev-docs" && r.devDocs !== null && r.devDocs.ok === true) ||
          (mode === "openspec" && r.openspec !== null && r.openspec.ok === true);
        const harnessOk = r.harness !== null && r.harness.ok === true;
        const superpowersOk =
          !superpowers || (r.superpowers !== null && r.superpowers.ok === true);

        // 规范工作流应用成功 → 持久化 workflowMode 进 projects.json
        if (specOk) {
          updateProjectWorkflowMode(proj.id, mode);
        }

        if (!specOk || !harnessOk || !superpowersOk) {
          serverLog(
            "error",
            "project",
            `apply-workflow 部分失败 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: {
                mode,
                specOk,
                harnessOk,
                superpowersOk,
                gstackInstalled: r.gstack !== null ? r.gstack.installed : null,
                partial: r.partial,
              },
            },
          );
          return reply.code(207).send(r);
        }
        serverLog(
          "info",
          "project",
          `apply-workflow 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              mode,
              superpowers,
              devDocsWrote:
                r.devDocs !== null && r.devDocs.ok ? r.devDocs.wrote : false,
              openspecCreated:
                r.openspec !== null && r.openspec.ok
                  ? r.openspec.created.length
                  : 0,
              harnessCopied:
                r.harness && r.harness.ok ? r.harness.copied.length : 0,
              harnessSkipped:
                r.harness && r.harness.ok ? r.harness.skipped.length : 0,
              superpowersWrote:
                r.superpowers !== null && r.superpowers.ok
                  ? r.superpowers.wrote
                  : false,
              gstackInstalled: r.gstack !== null ? r.gstack.installed : null,
            },
          },
        );
        return reply.send(r);
      } catch (err) {
        const msg = (err as Error).message || "apply-workflow failed";
        serverLog("error", "project", `apply-workflow 失败: ${msg}`, {
          projectId: proj.id,
          meta: {
            mode,
            superpowers,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return reply.code(500).send({ error: "apply_failed", detail: msg });
      }
    },
  );

  app.delete<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/workflow",
    async (req, reply) => {
      if (req.params.id === HUB_PROJECT_ID) {
        serverLog("warn", "hub", "拒绝 remove-workflow 从 __hub__", {
          projectId: HUB_PROJECT_ID,
        });
        return reply.code(400).send({ error: "hub_no_workflow" });
      }
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });

      // body 可省（兼容旧前端 DELETE 不带 body）
      let opts: { mode?: WorkflowMode; superpowers?: boolean } = {};
      if (req.body !== undefined && req.body !== null) {
        const parsed = WorkflowOptionsSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply
            .code(400)
            .send({ error: "invalid_body", detail: parsed.error.issues });
        }
        opts = parsed.data;
      }
      const mode = opts.mode ?? "dev-docs";
      const superpowers = opts.superpowers === true;

      const t0 = Date.now();
      serverLog("info", "project", "remove-workflow 开始", {
        projectId: proj.id,
        meta: { mode, superpowers },
      });
      try {
        const r = await removeWorkflowFromProject(proj.path, { mode, superpowers });

        // 规范工作流卸载成功 → 清空 workflowMode（按 mode 分支判定）
        // spec-trio 与 openspec 走同一份 scaffold，判定逻辑合并。
        const specChanged =
          (mode === "dev-docs" &&
            r.devDocs !== null &&
            r.devDocs.changed === true) ||
          ((mode === "openspec" || mode === "spec-trio") &&
            r.openspec !== null &&
            (r.openspec as { ok?: boolean }).ok === true);
        if (specChanged) {
          updateProjectWorkflowMode(proj.id, null);
        }

        if (r.partial) {
          serverLog(
            "error",
            "project",
            `remove-workflow 部分失败 (${Date.now() - t0}ms)`,
            {
              projectId: proj.id,
              meta: {
                mode,
                superpowers,
                devDocsChanged:
                  r.devDocs !== null ? r.devDocs.changed : null,
                harnessRemoved: r.harness.removedCount,
                harnessSkipped: r.harness.skippedCount,
                harnessFailed: r.harness.failedFiles.length,
                gstackInstalled: r.gstack !== null ? r.gstack.installed : null,
              },
            },
          );
          return reply.code(207).send({ ok: false, ...r });
        }
        serverLog(
          "info",
          "project",
          `remove-workflow 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              mode,
              superpowers,
              devDocsChanged:
                r.devDocs !== null ? r.devDocs.changed : null,
              harnessRemoved: r.harness.removedCount,
              harnessSkipped: r.harness.skippedCount,
              superpowersChanged:
                r.superpowers !== null ? r.superpowers.changed : null,
              gstackInstalled: r.gstack !== null ? r.gstack.installed : null,
            },
          },
        );
        return reply.send({ ok: true, ...r });
      } catch (err) {
        const msg = (err as Error).message || "remove-workflow failed";
        serverLog("error", "project", `remove-workflow 失败: ${msg}`, {
          projectId: proj.id,
          meta: {
            mode,
            superpowers,
            error: { name: (err as Error).name, message: msg },
          },
        });
        return reply.code(500).send({ error: "remove_failed", detail: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/workflow-status",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "workflow-status 开始", {
        projectId: proj.id,
      });
      try {
        // 传 persistedMode 让 detectedMode 能识别 spec-trio（磁盘上与 openspec+Superpowers 同形）
        const status = await getWorkflowStatus(
          proj.path,
          proj.workflowMode ?? null,
        );
        serverLog(
          "info",
          "project",
          `workflow-status 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: { applied: status.applied },
          },
        );
        return reply.send(status);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "project", `workflow-status 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "status_failed", detail: msg });
      }
    },
  );

  // 把本项目对齐到"最新独立文件形态"：老内联→迁移成 @引用+独立文件；已是文件形态→覆盖独立文件。
  // 只动 Dev Docs 工作流相关部分，CLAUDE.md 其余内容不动。
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/workflow/update",
    async (req, reply) => {
      if (req.params.id === HUB_PROJECT_ID) {
        return reply.code(400).send({ error: "hub_no_workflow" });
      }
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const t0 = Date.now();
      serverLog("info", "project", "update-workflow 开始", {
        projectId: proj.id,
      });
      try {
        const r = updateProjectDevDocs(proj.path);
        serverLog(
          "info",
          "project",
          `update-workflow 成功 (${Date.now() - t0}ms)`,
          {
            projectId: proj.id,
            meta: {
              changed: r.changed,
              form: r.form,
              action: r.action,
              reason: r.reason ?? null,
              installedVersion: r.installedVersion,
              currentVersion: r.currentVersion,
            },
          },
        );
        return reply.send(r);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "project", `update-workflow 失败: ${msg}`, {
          projectId: proj.id,
          meta: { error: { name: (err as Error).name, message: msg } },
        });
        return reply.code(500).send({ error: "update_failed", detail: msg });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/layout",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      return proj.layout ?? null;
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/layout",
    async (req, reply) => {
      const parsed = LayoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const ok = updateProjectLayout(req.params.id, {
        ...parsed.data,
        updatedAt: Date.now(),
      });
      if (!ok) return reply.code(404).send({ error: "not_found" });
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/skills",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      const skills = await listSkills(proj.path);
      // Wire shape omits body to keep response small.
      return skills.map((s) => ({ name: s.name, triggers: s.triggers }));
    },
  );

  // 一键启动脚本：解析出该项目要跑的绝对路径 + 列出根目录候选 bat。
  // resolved 优先用已存的 startScript（校验存在且是 bat/cmd），否则回退根目录 start.bat，都没有返回 null。
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/start-script",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "not_found" });
      let resolved: string | null = null;
      if (proj.startScript) {
        const abs = resolveStartScript(proj.path, proj.startScript);
        if (BAT_RE.test(abs) && existsSync(abs)) resolved = abs;
      }
      if (!resolved) {
        const defaultBat = join(proj.path, "start.bat");
        if (existsSync(defaultBat)) resolved = defaultBat;
      }
      return { resolved, candidates: listBatCandidates(proj.path) };
    },
  );

  // 设置/清空一键启动脚本（写 projects.json 真源）。script=null 清空。
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/start-script",
    async (req, reply) => {
      const { id } = req.params;
      const parsed = StartScriptSchema.safeParse(req.body);
      if (!parsed.success) {
        serverLog("error", "project", "set-start-script 失败: invalid_body", {
          projectId: id,
          meta: { issues: parsed.error.issues },
        });
        return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const proj = getProject(id);
      if (!proj) return reply.code(404).send({ error: "not_found" });

      const raw = parsed.data.script;
      serverLog("info", "project", "set-start-script 开始", {
        projectId: id,
        meta: { script: raw },
      });
      const t0 = Date.now();

      let stored: string | null = null;
      if (raw !== null) {
        if (!BAT_RE.test(raw)) {
          serverLog("error", "project", "set-start-script 失败: not_bat", {
            projectId: id,
            meta: { script: raw },
          });
          return reply.code(400).send({ error: "not_bat" });
        }
        const abs = resolveStartScript(proj.path, raw);
        if (!existsSync(abs)) {
          serverLog("error", "project", "set-start-script 失败: file_not_found", {
            projectId: id,
            meta: { script: raw, abs },
          });
          return reply.code(400).send({ error: "file_not_found", path: abs });
        }
        stored = normalizeStartScript(proj.path, raw);
      }

      const ok = updateProjectStartScript(id, stored);
      if (!ok) return reply.code(404).send({ error: "not_found" });
      serverLog("info", "project", `set-start-script 成功 (${Date.now() - t0}ms)`, {
        projectId: id,
        meta: { startScript: stored },
      });
      return reply.send({ startScript: stored });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (req, reply) => {
      const { id } = req.params;
      if (id === HUB_PROJECT_ID) {
        serverLog("warn", "hub", "拒绝 delete __hub__ 系统项目", {
          projectId: HUB_PROJECT_ID,
        });
        return reply.code(400).send({ error: "cannot_delete_hub" });
      }
      const proj = getProject(id);
      if (!proj) return reply.code(404).send({ error: "not_found" });

      // Kill any live sessions for this project, then mark them stopped, and
      // GC their worktrees (if any) so server data/worktrees/<projectId>/ is
      // emptied alongside the project row.
      const sessions = listSessionsByProject(id);
      for (const s of sessions) {
        if (ptyManager.isAlive(s.id)) {
          ptyManager.kill(s.id, "project-delete");
          endSession(s.id, "stopped", null);
        }
        if (s.isolation === "worktree" && s.worktreePath) {
          try {
            await removeWorktree(proj.path, s.worktreePath, { force: true });
          } catch (err) {
            // Don't block project delete on a residual worktree directory —
            // log a warning and move on.
            serverLog(
              "warn",
              "git",
              `worktree-remove (project delete) 失败: ${(err as Error).message}`,
              {
                projectId: id,
                sessionId: s.id,
                meta: { worktreePath: s.worktreePath },
              },
            );
          }
        }
      }
      const ok = dbDeleteProject(id);
      return reply.send({ ok, id });
    },
  );
}
