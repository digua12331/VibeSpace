/**
 * Server-side equivalent of `templates/harness/install.sh` —— 把 VibeSpace
 * 仓库根的 .aimon/skills + .aimon/docs + dev/harness-*.md + 一份 CUSTOMIZE
 * + `templates/agent-team/` 的通用团队 agent（team-*，带指纹标记支持升级）
 * 拷到目标项目，并往 .gitignore 追加 `.aimon/runtime/`。
 * "已存在则跳过"与脚本行为一致（team 文件例外：原样未改且落后时刷新）；
 * 不引新依赖（全用 node:fs/promises + node:crypto）。
 *
 * **同步提醒**：未来加新模板文件时，本文件的 `getTemplateFiles()` 与
 * `templates/harness/install.sh` 的两段 `for f in ...` 都要改——它们是两份
 * 独立实现（一份 TS / 一份 bash），不强行共享常量。
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, appendFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HarnessFileKind = "skill" | "agent" | "doc" | "customize" | "workflow-doc";

export interface HarnessFileSpec {
  /** Absolute source path inside the VibeSpace repo. */
  srcAbs: string;
  /** POSIX-style relative destination inside the target project. */
  dstRel: string;
  kind: HarnessFileKind;
  /** True for team templates: install appends a fingerprint stamp line so
   *  re-apply can refresh outdated-but-unmodified copies and uninstall can
   *  tell "installed by us" from user-authored files. */
  stamped?: boolean;
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

  // .aimon/docs/*.md —— 大哥入口手册 + AI 执行手册
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

  // templates/agent-team/team-*.md —— 去项目化的通用团队（不再拷仓库根的
  // vibespace-* 专属 agent 给其他项目；本仓库自己的 vibespace-* 原件不动）。
  // team-usage.md 是给主 AI 的派工说明书，落到 .aimon/docs/。
  const teamDir = repoFile("templates", "agent-team");
  if (existsSync(teamDir)) {
    const names = await readdir(teamDir);
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      if (name === "team-usage.md") {
        out.push({
          srcAbs: join(teamDir, name),
          dstRel: ".aimon/docs/team-usage.md",
          kind: "workflow-doc",
          stamped: true,
        });
      } else {
        out.push({
          srcAbs: join(teamDir, name),
          dstRel: `.claude/agents/${name}`,
          kind: "agent",
          stamped: true,
        });
      }
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

// ---------- Team template stamp ----------

/**
 * 装配 team 模板时在文件末尾追加一行指纹标记：
 *   <!-- aimon-team-agent v=1 fp=<sha256 前 12 位> -->
 * fp 是"剥离标记行后的正文"的指纹。三个用途：
 *   - 重复应用：有标记 + 正文未改 + fp 落后于当前母版 → 安全刷新；
 *   - 卸载：有标记 + 正文未改 → 确认是我们装的原样文件，可删；
 *   - 用户改过（正文 hash 与 fp 不符）或无标记 → 一律不动。
 * 标记放末尾而不是开头：agent md 的 frontmatter `---` 必须在第一行。
 */
const TEAM_STAMP_RE = /\n?<!-- aimon-team-agent v=(\d+) fp=([0-9a-f]{12}) -->\s*$/;

function fpOf(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex").slice(0, 12);
}

function withStamp(body: string): string {
  const trimmed = body.replace(/\s*$/, "\n");
  return `${trimmed}<!-- aimon-team-agent v=1 fp=${fpOf(trimmed)} -->\n`;
}

/** Parse a stamped file. Returns null when no stamp line is present. */
function parseStamp(content: string): { fp: string; body: string; pristine: boolean } | null {
  const m = content.match(TEAM_STAMP_RE);
  if (!m) return null;
  const body = content.slice(0, m.index ?? 0).replace(/\s*$/, "\n");
  const fp = m[2];
  return { fp, body, pristine: fpOf(body) === fp };
}

/** 历史错拷清理名单：旧版装配曾把仓库根的 vibespace-* 专属 agent 拷给目标项目。 */
const LEGACY_AGENT_FILES = [
  "vibespace-browser-tester.md",
  "vibespace-db-scribe.md",
  "vibespace-explorer.md",
  "vibespace-route-author.md",
  "vibespace-rules-auditor.md",
  "vibespace-smoke-author.md",
  "vibespace-ui-decorator.md",
];

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
      // renamed = 用户已本地化改造：有原样指纹标记 → false；标记缺失或正文被改 → true
      try {
        const parsed = parseStamp(await readFile(dst, "utf8"));
        renamed = !(parsed?.pristine ?? false);
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
    if (!spec.stamped) {
      if (existsSync(dst)) {
        skipped.push(spec.dstRel);
        continue;
      }
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(spec.srcAbs, dst);
      copied.push(spec.dstRel);
      continue;
    }

    // Stamped team files: write template body + fingerprint line; on
    // re-apply, refresh only copies that are pristine (stamp matches body)
    // AND outdated (stamp differs from current template). User-authored or
    // user-modified files are never touched.
    const stamped = withStamp(await readFile(spec.srcAbs, "utf8"));
    if (!existsSync(dst)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, stamped, "utf8");
      copied.push(spec.dstRel);
      continue;
    }
    let refresh = false;
    try {
      const parsed = parseStamp(await readFile(dst, "utf8"));
      refresh = parsed != null && parsed.pristine && parsed.fp !== parseStamp(stamped)!.fp;
    } catch {
      refresh = false;
    }
    if (refresh) {
      await writeFile(dst, stamped, "utf8");
      copied.push(spec.dstRel);
    } else {
      skipped.push(spec.dstRel);
    }
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
  /** team-* files removed (subset of removedCount), for log meta. */
  teamAgentsRemoved: number;
  /** Legacy vibespace-* copies cleaned up in the target project. */
  legacyCleaned: string[];
}

export async function uninstallHarnessTemplate(
  projectPath: string,
): Promise<UninstallResult> {
  const specs = await getTemplateFiles();
  let removedCount = 0;
  let skippedCount = 0;
  let teamAgentsRemoved = 0;
  const failedFiles: string[] = [];
  for (const spec of specs) {
    const dst = join(projectPath, spec.dstRel);
    if (spec.stamped) {
      // Team files: only remove copies we can confirm we installed and the
      // user hasn't modified (pristine stamp). Modified/unstamped → keep.
      try {
        const parsed = parseStamp(await readFile(dst, "utf8"));
        if (!parsed?.pristine) {
          skippedCount++;
          continue;
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") skippedCount++;
        else failedFiles.push(spec.dstRel);
        continue;
      }
    }
    try {
      await unlink(dst);
      removedCount++;
      if (spec.stamped) teamAgentsRemoved++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") skippedCount++;
      else failedFiles.push(spec.dstRel);
    }
  }

  // 历史错拷清理：旧版装配拷过去的 vibespace-* 专属 agent。仅当文件还含
  // `vibespace-` 字面量（= 用户未改造的原件）才删，拿不准一律保留。
  // 本仓库（母版所在地）跳过——否则在 VibeSpace 仓库自己点卸载会删掉母版原件。
  const legacyCleaned: string[] = [];
  if (resolve(projectPath) !== REPO_ROOT) {
    for (const name of LEGACY_AGENT_FILES) {
      const rel = `.claude/agents/${name}`;
      const abs = join(projectPath, rel);
      try {
        const body = await readFile(abs, "utf8");
        if (!body.includes("vibespace-")) continue; // 用户改造过，保留
        await unlink(abs);
        legacyCleaned.push(rel);
      } catch {
        // ENOENT / 读失败：跳过即可，legacy 清理是尽力而为
      }
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
  return { removedCount, skippedCount, failedFiles, teamAgentsRemoved, legacyCleaned };
}
