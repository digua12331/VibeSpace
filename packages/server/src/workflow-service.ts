/**
 * "项目工作流" 聚合层 —— Dev Docs（写 CLAUDE.md 工作流段）+ Harness（拷
 * .aimon / .claude / dev 文件夹）原本是两件事，但大哥视角下"装这套"就是
 * 一件事；本文件把两套子能力包成一对统一 API：apply / remove / status。
 *
 * 两个子能力的实现：
 * - Dev Docs：写入 CLAUDE.md 的工作流文本段落，逻辑在本文件内（原来散在
 *   routes/projects.ts 里，本任务一并搬过来——只在 workflow 内部调，没必要
 *   再单独抽一个 dev-docs-service.ts）。
 * - Harness：调用 `harness-template-service` 现成的 apply/remove/status。
 *
 * 失败语义：apply 时第一步（Dev Docs）失败直接 abort 不调第二步；第一步
 * 成功第二步（Harness）失败时不回滚——`partial: true` 让 UI 明确告知，
 * 重试时第一步幂等（anchor 已在 → no-op）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_DOCS_GUIDELINES,
  ISSUES_ARCHIVE_SECTION,
} from "./dev-docs-guidelines.js";
import {
  applyHarnessTemplate,
  getHarnessStatus,
  uninstallHarnessTemplate,
  type ApplyResult as HarnessApplyResult,
  type HarnessStatus,
  type UninstallResult as HarnessUninstallResult,
} from "./harness-template-service.js";

// ---------- Dev Docs (CLAUDE.md 段落) ----------

const MAIN_GUIDELINES_ANCHOR = "# Dev Docs 工作流";
const ISSUES_SECTION_ANCHOR = "## Issues 档案";

function appendToClaudeMd(
  projectPath: string,
  body: string,
  anchor: string,
): boolean {
  const target = join(projectPath, "CLAUDE.md");
  let existing = "";
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    // file does not exist — write fresh
  }
  if (anchor && existing.includes(anchor)) return false;
  const needsSeparator = existing.length > 0;
  const trailingNewlines = existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  const payload = needsSeparator
    ? `${existing}${trailingNewlines}---\n\n${body}`
    : body;
  writeFileSync(target, payload, "utf8");
  return true;
}

function insertSectionBeforeSeparator(
  projectPath: string,
  section: string,
  sectionAnchor: string,
  mainAnchor: string,
): boolean {
  const target = join(projectPath, "CLAUDE.md");
  let existing: string;
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    return false;
  }
  const mainIdx = existing.indexOf(mainAnchor);
  if (mainIdx < 0) return false;

  const afterMain = existing.slice(mainIdx);
  const sepMatch = /\n---\s*\n/.exec(afterMain);
  const blockEndRel = sepMatch ? sepMatch.index + 1 : afterMain.length;
  const block = afterMain.slice(0, blockEndRel);

  if (block.includes(sectionAnchor)) return false;

  const blockTrimmed = block.replace(/\s+$/, "");
  const rebuiltBlock = `${blockTrimmed}\n\n${section.trimEnd()}\n`;
  const rebuilt =
    existing.slice(0, mainIdx) + rebuiltBlock + afterMain.slice(blockEndRel);
  writeFileSync(target, rebuilt, "utf8");
  return true;
}

function appendDevDocsGuidelines(projectPath: string): boolean {
  const wroteFull = appendToClaudeMd(
    projectPath,
    DEV_DOCS_GUIDELINES,
    MAIN_GUIDELINES_ANCHOR,
  );
  if (wroteFull) return true;
  return insertSectionBeforeSeparator(
    projectPath,
    ISSUES_ARCHIVE_SECTION,
    ISSUES_SECTION_ANCHOR,
    MAIN_GUIDELINES_ANCHOR,
  );
}

function removeDevDocsGuidelines(projectPath: string): {
  changed: boolean;
  reason?: "claude_md_missing" | "anchor_missing";
} {
  const target = join(projectPath, "CLAUDE.md");
  let content: string;
  try {
    content = readFileSync(target, "utf8");
  } catch {
    return { changed: false, reason: "claude_md_missing" };
  }
  const REMOVE_PREFIX = "\n\n---\n\n" + MAIN_GUIDELINES_ANCHOR;
  const idx = content.indexOf(REMOVE_PREFIX);
  if (idx < 0) {
    // CLAUDE.md 存在但里面没有"# Dev Docs 工作流"段——可能是用户手写过、
    // 或本来就没装；按 idempotent 处理。
    return { changed: false, reason: "anchor_missing" };
  }
  const trimmed = content.slice(0, idx).replace(/\s+$/, "");
  writeFileSync(target, trimmed + "\n", "utf8");
  return { changed: true };
}

function getDevDocsStatus(projectPath: string): {
  enabled: boolean;
  claudeMdExists: boolean;
} {
  const target = join(projectPath, "CLAUDE.md");
  let claudeMdExists = true;
  let content = "";
  try {
    content = readFileSync(target, "utf8");
  } catch {
    claudeMdExists = false;
  }
  const enabled =
    claudeMdExists && content.indexOf(MAIN_GUIDELINES_ANCHOR) >= 0;
  return { enabled, claudeMdExists };
}

// ---------- 聚合 API ----------

export interface WorkflowApplyResult {
  /** Dev Docs 子结果（始终存在；apply 一定先跑这一步）。 */
  devDocs: { ok: true; wrote: boolean } | { ok: false; error: string };
  /**
   * Harness 子结果。
   * - `null` 表示因 devDocs 失败而 abort，没跑这一步；
   * - 否则结构同 `harness-template-service.ApplyResult` 加 ok 标记。
   */
  harness:
    | null
    | ({ ok: true } & HarnessApplyResult)
    | { ok: false; error: string };
  /**
   * 一致性标志：
   * - `false`：两步都成功，或 devDocs 失败 abort（双方都未生效，状态干净）；
   * - `true`：devDocs 成功但 harness 失败——CLAUDE.md 已写入文件夹未拷全。
   */
  partial: boolean;
}

export interface WorkflowRemoveResult {
  devDocs: { changed: boolean; reason?: string };
  harness: HarnessUninstallResult;
  partial: boolean;
}

export interface WorkflowStatus {
  devDocs: { enabled: boolean; claudeMdExists: boolean };
  harness: HarnessStatus;
  /**
   * 聚合状态：
   * - `none` —— 两边都未应用；
   * - `partial` —— 只装了一边；
   * - `full` —— 两边都已应用。
   * 由前端决定按钮文案与状态徽章。
   */
  applied: "none" | "partial" | "full";
}

export async function applyWorkflowToProject(
  projectPath: string,
): Promise<WorkflowApplyResult> {
  // Step 1: Dev Docs（写 CLAUDE.md）
  let devDocsResult: WorkflowApplyResult["devDocs"];
  try {
    const wrote = appendDevDocsGuidelines(projectPath);
    devDocsResult = { ok: true, wrote };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    return {
      devDocs: { ok: false, error: msg },
      harness: null,
      partial: false,
    };
  }

  // Step 2: Harness（拷文件夹）
  try {
    const r = await applyHarnessTemplate(projectPath);
    return {
      devDocs: devDocsResult,
      harness: { ok: true, ...r },
      partial: false,
    };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    return {
      devDocs: devDocsResult,
      harness: { ok: false, error: msg },
      partial: true,
    };
  }
}

export async function removeWorkflowFromProject(
  projectPath: string,
): Promise<WorkflowRemoveResult> {
  // 顺序反向：先卸 Harness 文件，再撤 CLAUDE.md 段落。文件清理失败时
  // 仍然继续撤 CLAUDE.md 段，failedFiles 透传给前端展示。
  const harnessResult = await uninstallHarnessTemplate(projectPath);
  const devDocsResult = removeDevDocsGuidelines(projectPath);
  return {
    devDocs: devDocsResult,
    harness: harnessResult,
    partial: harnessResult.failedFiles.length > 0,
  };
}

export async function getWorkflowStatus(
  projectPath: string,
): Promise<WorkflowStatus> {
  const devDocs = getDevDocsStatus(projectPath);
  const harness = await getHarnessStatus(projectPath);
  const harnessApplied = existsSync(join(projectPath, ".aimon", "skills"));
  let applied: WorkflowStatus["applied"];
  if (devDocs.enabled && harnessApplied) applied = "full";
  else if (!devDocs.enabled && !harnessApplied) applied = "none";
  else applied = "partial";
  return { devDocs, harness, applied };
}
