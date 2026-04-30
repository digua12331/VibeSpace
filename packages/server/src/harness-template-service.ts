/**
 * Server-side equivalent of `templates/harness/install.sh` —— 把 VibeSpace
 * 仓库根的 .aimon/skills + .aimon/docs + .claude/agents + dev/harness-*.md
 * + 一份 CUSTOMIZE 拷到目标项目，并往 .gitignore 追加 `.aimon/runtime/`。
 * "已存在则跳过"与脚本行为一致；不引新依赖（全用 node:fs/promises）。
 *
 * **同步提醒**：未来加新模板文件时，本文件的 `getTemplateFiles()` 与
 * `templates/harness/install.sh` 的两段 `for f in ...` 都要改——它们是两份
 * 独立实现（一份 TS / 一份 bash），不强行共享常量。
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, appendFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HarnessFileKind = "skill" | "agent" | "doc" | "customize" | "workflow-doc";

export interface HarnessFileSpec {
  /** Absolute source path inside the VibeSpace repo. */
  srcAbs: string;
  /** POSIX-style relative destination inside the target project. */
  dstRel: string;
  kind: HarnessFileKind;
}

export interface HarnessFileEntry {
  kind: HarnessFileKind;
  /** Same as HarnessFileSpec.dstRel; what UI shows. */
  relPath: string;
  exists: boolean;
  /** True only for kind='agent' when the file body still contains the literal `vibespace-`
   *  string —— i.e. the user hasn't renamed/customised it yet. Always false for non-agent kinds. */
  renamed: boolean;
}

export interface HarnessStatus {
  installed: number;
  total: number;
  entries: HarnessFileEntry[];
  /** True when target's .gitignore contains a line for `.aimon/runtime/`. */
  gitignoreHasRuntime: boolean;
}

export interface ApplyResult {
  copied: string[];
  skipped: string[];
  gitignoreAppended: boolean;
}

// ---------- Repo root resolution ----------

const __filename = fileURLToPath(import.meta.url);
// packages/server/src/harness-template-service.ts → 仓库根（上 3 级）
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..");

const RUNTIME_GITIGNORE_LINE = ".aimon/runtime/";
const RUNTIME_GITIGNORE_HEADER = "# Harness runtime prompts (generated per-session, ignore)";

function repoFile(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

// ---------- Template manifest ----------

/**
 * Build the list of files to copy from the VibeSpace repo into a target
 * project. Skill / agent files are discovered dynamically (whatever's in
 * the repo at install time gets copied), so adding a new skill / agent
 * doesn't require updating this function.
 */
export async function getTemplateFiles(): Promise<HarnessFileSpec[]> {
  const out: HarnessFileSpec[] = [];

  // .aimon/skills/*.md
  const skillsDir = repoFile(".aimon", "skills");
  if (existsSync(skillsDir)) {
    const names = await readdir(skillsDir);
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      out.push({
        srcAbs: join(skillsDir, name),
        dstRel: `.aimon/skills/${name}`,
        kind: "skill",
      });
    }
  }

  // .aimon/docs/*.md —— 主理人入口手册 + AI 执行手册
  const workflowDocsDir = repoFile(".aimon", "docs");
  if (existsSync(workflowDocsDir)) {
    const names = await readdir(workflowDocsDir);
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      out.push({
        srcAbs: join(workflowDocsDir, name),
        dstRel: `.aimon/docs/${name}`,
        kind: "workflow-doc",
      });
    }
  }

  // .claude/agents/*.md
  const agentsDir = repoFile(".claude", "agents");
  if (existsSync(agentsDir)) {
    const names = await readdir(agentsDir);
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      out.push({
        srcAbs: join(agentsDir, name),
        dstRel: `.claude/agents/${name}`,
        kind: "agent",
      });
    }
  }

  // dev/harness-roadmap.md + dev/agent-team-blueprint.md
  for (const docName of ["harness-roadmap.md", "agent-team-blueprint.md"]) {
    const srcAbs = repoFile("dev", docName);
    if (existsSync(srcAbs)) {
      out.push({
        srcAbs,
        dstRel: `dev/${docName}`,
        kind: "doc",
      });
    }
  }

  // templates/harness/CUSTOMIZE.md → 目标项目里改名 .aimon/CUSTOMIZE-harness.md
  const customizeAbs = repoFile("templates", "harness", "CUSTOMIZE.md");
  if (existsSync(customizeAbs)) {
    out.push({
      srcAbs: customizeAbs,
      dstRel: ".aimon/CUSTOMIZE-harness.md",
      kind: "customize",
    });
  }

  return out;
}

// ---------- Status probe ----------

/**
 * 用 `<projectPath>/.aimon/skills` 目录是否存在作为"已应用 Harness"的稳定信号：
 * apply 一定会创建这个目录，且 skills 是 apply 的核心产物（路径在本文件 manifest
 * 里硬编码、不会被用户随手删空），比扫文件级别清单更轻、抖动更少。
 */
export function isHarnessApplied(projectPath: string): boolean {
  return existsSync(join(projectPath, ".aimon", "skills"));
}

export async function getHarnessStatus(
  projectPath: string,
): Promise<HarnessStatus> {
  const specs = await getTemplateFiles();
  const entries: HarnessFileEntry[] = [];
  let installed = 0;

  for (const spec of specs) {
    const dst = join(projectPath, spec.dstRel);
    const exists = existsSync(dst);
    let renamed = false;
    if (exists && spec.kind === "agent") {
      // Agent 文件如果还含字面 `vibespace-` 字符串 = 用户没改名 = 未改造
      try {
        const body = await readFile(dst, "utf8");
        renamed = !body.includes("vibespace-");
      } catch {
        renamed = false;
      }
    }
    if (exists) installed += 1;
    entries.push({ kind: spec.kind, relPath: spec.dstRel, exists, renamed });
  }

  const gitignoreHasRuntime = await checkGitignoreHasRuntime(projectPath);

  return {
    installed,
    total: specs.length,
    entries,
    gitignoreHasRuntime,
  };
}

async function checkGitignoreHasRuntime(projectPath: string): Promise<boolean> {
  const gi = join(projectPath, ".gitignore");
  if (!existsSync(gi)) return false;
  try {
    const body = await readFile(gi, "utf8");
    // 匹配 `.aimon/runtime/` 或 `.aimon/runtime`，行首到行尾
    return /(?:^|\n)\.aimon\/runtime\/?(?:\r?\n|$)/.test(body);
  } catch {
    return false;
  }
}

// ---------- Apply ----------

export async function applyHarnessTemplate(
  projectPath: string,
): Promise<ApplyResult> {
  const specs = await getTemplateFiles();
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const spec of specs) {
    const dst = join(projectPath, spec.dstRel);
    if (existsSync(dst)) {
      skipped.push(spec.dstRel);
      continue;
    }
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(spec.srcAbs, dst);
    copied.push(spec.dstRel);
  }

  const gitignoreAppended = await ensureGitignoreRuntime(projectPath);

  return { copied, skipped, gitignoreAppended };
}

async function ensureGitignoreRuntime(projectPath: string): Promise<boolean> {
  const gi = join(projectPath, ".gitignore");
  if (await checkGitignoreHasRuntime(projectPath)) return false;
  const block = `\n${RUNTIME_GITIGNORE_HEADER}\n${RUNTIME_GITIGNORE_LINE}\n`;
  if (existsSync(gi)) {
    await appendFile(gi, block, "utf8");
  } else {
    await writeFile(gi, `${RUNTIME_GITIGNORE_LINE}\n`, "utf8");
  }
  return true;
}

// ---------- Uninstall ----------

export interface UninstallResult {
  removedCount: number;
  skippedCount: number;
  failedFiles: string[];
}

export async function uninstallHarnessTemplate(
  projectPath: string,
): Promise<UninstallResult> {
  const specs = await getTemplateFiles();
  let removedCount = 0;
  let skippedCount = 0;
  const failedFiles: string[] = [];
  for (const { dstRel } of specs) {
    try {
      await unlink(join(projectPath, dstRel));
      removedCount++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") skippedCount++;
      else failedFiles.push(dstRel);
    }
  }
  // 叶子→根：仅在目录已空时成功，非空 ENOTEMPTY / 不存在 ENOENT 都跳过，
  // 天然保护用户在同目录新建的文件。目的是让 isHarnessApplied 探测点（.aimon/skills/）
  // 卸载后回 false，避免抽屉重开时状态回弹。
  for (const dirRel of [".aimon/docs", ".aimon/skills", ".claude/agents", ".aimon"]) {
    try {
      await rmdir(join(projectPath, dirRel));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" && code !== "ENOENT" && code !== "EEXIST") {
        // 其他错误（如 EPERM）不影响卸载主流程，仅记入 failedFiles 让前端提示
        failedFiles.push(dirRel + "/");
      }
    }
  }
  return { removedCount, skippedCount, failedFiles };
}
