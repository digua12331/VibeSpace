/**
 * "项目工作流" 聚合层 —— 一对统一 API（apply / remove / status）封装四件子能力：
 *
 *  1. **Dev Docs**：写 CLAUDE.md 的"# Dev Docs 工作流"段（逻辑在本文件内）
 *  2. **OpenSpec**：建 `openspec/{specs,changes,archive}/` 骨架（委托
 *     `openspec-template-service.ts`）
 *  3. **Harness**：拷 `.aimon / .claude / dev` 文件夹（委托
 *     `harness-template-service.ts`）
 *  4. **Superpowers**：写 CLAUDE.md 的"# Superpowers 7 步流程"段（委托
 *     `superpowers-guidelines.ts`）
 *
 * **mode 概念**：Dev Docs 与 OpenSpec **项目级二选一**——同一项目同一时间
 * 只装一种"规范工作流"，由调用方传 `opts.mode` 决定（默认 `"dev-docs"`，与本
 * 文件早期版本零参调用行为完全一致）。Harness 与 Superpowers 与 mode 正交：
 * Harness 始终装；Superpowers 只在 `opts.superpowers === true` 时装。
 *
 * **失败语义**：
 * - apply：第一步（规范工作流：dev-docs **或** openspec）失败直接 abort，
 *   后续不执行；第一步成功而 harness/superpowers 失败时不回滚——`partial: true`
 *   让 UI 明确告知，重试时第一步幂等（anchor / 目录已在 → no-op）。
 * - remove：先卸 Harness 文件，再撤 CLAUDE.md 段；任意一步失败 partial。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowMode } from "./db.js";
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
import {
  applyOpenSpecTemplate,
  getOpenSpecStatus,
  uninstallOpenSpecTemplate,
  type OpenSpecApplyResult,
  type OpenSpecStatus,
  type OpenSpecUninstallResult,
} from "./openspec-template-service.js";
import {
  appendSuperpowersGuidelines,
  getSuperpowersStatus,
  removeSuperpowersGuidelines,
} from "./superpowers-guidelines.js";

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

export interface WorkflowApplyOptions {
  /** 规范工作流模式；默认 "dev-docs"（保留零参兼容）。 */
  mode?: WorkflowMode;
  /** 是否同时装 Superpowers 7 步流程提示段。 */
  superpowers?: boolean;
}

export interface WorkflowRemoveOptions {
  /** 撤掉哪种规范工作流；默认 "dev-docs"。 */
  mode?: WorkflowMode;
  /** 是否同时撤 Superpowers 段。 */
  superpowers?: boolean;
}

export interface WorkflowApplyResult {
  /** 本次 apply 实际应用的规范工作流模式。 */
  mode: WorkflowMode;
  /** Dev Docs 子结果；仅 mode === "dev-docs" 时存在，其余为 null。 */
  devDocs:
    | null
    | { ok: true; wrote: boolean }
    | { ok: false; error: string };
  /** OpenSpec 子结果；仅 mode === "openspec" 时存在，其余为 null。 */
  openspec:
    | null
    | ({ ok: true } & OpenSpecApplyResult)
    | { ok: false; error: string };
  /**
   * Harness 子结果（与 mode 正交，始终尝试装）。
   * - `null` 表示因第一步规范工作流失败而 abort，没跑这一步；
   * - 否则结构同 `harness-template-service.ApplyResult` 加 ok 标记。
   */
  harness:
    | null
    | ({ ok: true } & HarnessApplyResult)
    | { ok: false; error: string };
  /** Superpowers 子结果；仅 superpowers === true 时存在。 */
  superpowers:
    | null
    | { ok: true; wrote: boolean }
    | { ok: false; error: string };
  /**
   * 一致性标志：
   * - `false`：所有应跑步骤都成功 / 第一步失败 abort（状态干净）；
   * - `true`：第一步成功但 harness 或 superpowers 失败——CLAUDE.md/目录已写入但配套未装全。
   */
  partial: boolean;
}

export interface WorkflowRemoveResult {
  mode: WorkflowMode;
  devDocs: null | { changed: boolean; reason?: string };
  openspec:
    | null
    | ({ ok: true } & OpenSpecUninstallResult)
    | { ok: false; error: string };
  harness: HarnessUninstallResult;
  superpowers: null | { changed: boolean; reason?: string };
  partial: boolean;
}

export interface WorkflowStatus {
  /** 探测出的当前规范工作流；用 anchor / 目录探测，不依赖 db 持久化字段。 */
  detectedMode: WorkflowMode | null;
  devDocs: { enabled: boolean; claudeMdExists: boolean };
  openspec: OpenSpecStatus;
  harness: HarnessStatus;
  superpowers: { enabled: boolean; claudeMdExists: boolean };
  /**
   * 聚合状态（基于 detectedMode 对应的规范工作流 + harness）：
   * - `none` —— 都未应用；
   * - `partial` —— 只装了一边；
   * - `full` —— 两边都已应用。
   * 由前端决定按钮文案与状态徽章。
   */
  applied: "none" | "partial" | "full";
}

export async function applyWorkflowToProject(
  projectPath: string,
  opts: WorkflowApplyOptions = {},
): Promise<WorkflowApplyResult> {
  const mode: WorkflowMode = opts.mode ?? "dev-docs";
  const superpowersOn = opts.superpowers === true;

  // Step 1: 规范工作流（按 mode 选 dev-docs 或 openspec）
  let devDocsResult: WorkflowApplyResult["devDocs"] = null;
  let openspecResult: WorkflowApplyResult["openspec"] = null;
  if (mode === "dev-docs") {
    try {
      const wrote = appendDevDocsGuidelines(projectPath);
      devDocsResult = { ok: true, wrote };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      return {
        mode,
        devDocs: { ok: false, error: msg },
        openspec: null,
        harness: null,
        superpowers: null,
        partial: false,
      };
    }
  } else {
    try {
      const r = await applyOpenSpecTemplate(projectPath);
      openspecResult = { ok: true, ...r };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      return {
        mode,
        devDocs: null,
        openspec: { ok: false, error: msg },
        harness: null,
        superpowers: null,
        partial: false,
      };
    }
  }

  // Step 2: Harness（与 mode 正交，始终装）
  let harnessResult: WorkflowApplyResult["harness"] = null;
  let partial = false;
  try {
    const r = await applyHarnessTemplate(projectPath);
    harnessResult = { ok: true, ...r };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    harnessResult = { ok: false, error: msg };
    partial = true;
  }

  // Step 3: Superpowers（可选）
  let superpowersResult: WorkflowApplyResult["superpowers"] = null;
  if (superpowersOn) {
    try {
      const wrote = appendSuperpowersGuidelines(projectPath);
      superpowersResult = { ok: true, wrote };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      superpowersResult = { ok: false, error: msg };
      partial = true;
    }
  }

  return {
    mode,
    devDocs: devDocsResult,
    openspec: openspecResult,
    harness: harnessResult,
    superpowers: superpowersResult,
    partial,
  };
}

export async function removeWorkflowFromProject(
  projectPath: string,
  opts: WorkflowRemoveOptions = {},
): Promise<WorkflowRemoveResult> {
  const mode: WorkflowMode = opts.mode ?? "dev-docs";
  const superpowersOff = opts.superpowers === true;

  // 顺序反向：先卸 Harness 文件，再撤 CLAUDE.md 段 / OpenSpec 目录。
  // 文件清理失败时仍然继续撤 CLAUDE.md 段，failedFiles 透传给前端展示。
  const harnessResult = await uninstallHarnessTemplate(projectPath);

  let devDocsResult: WorkflowRemoveResult["devDocs"] = null;
  let openspecResult: WorkflowRemoveResult["openspec"] = null;
  if (mode === "dev-docs") {
    devDocsResult = removeDevDocsGuidelines(projectPath);
  } else {
    try {
      const r = await uninstallOpenSpecTemplate(projectPath);
      openspecResult = { ok: true, ...r };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      openspecResult = { ok: false, error: msg };
    }
  }

  let superpowersResult: WorkflowRemoveResult["superpowers"] = null;
  if (superpowersOff) {
    superpowersResult = removeSuperpowersGuidelines(projectPath);
  }

  // partial：harness 有失败、或 openspec 卸载失败、或 openspec 卸载有 preserved（用户保留内容）
  const openspecPartial =
    openspecResult !== null &&
    "ok" in openspecResult &&
    (!openspecResult.ok ||
      (openspecResult.ok && (openspecResult.failedPaths.length > 0 || openspecResult.preservedPaths.length > 0)));
  const partial = harnessResult.failedFiles.length > 0 || openspecPartial;

  return {
    mode,
    devDocs: devDocsResult,
    openspec: openspecResult,
    harness: harnessResult,
    superpowers: superpowersResult,
    partial,
  };
}

export async function getWorkflowStatus(
  projectPath: string,
): Promise<WorkflowStatus> {
  const devDocs = getDevDocsStatus(projectPath);
  const openspec = await getOpenSpecStatus(projectPath);
  const harness = await getHarnessStatus(projectPath);
  const superpowers = getSuperpowersStatus(projectPath);
  const harnessApplied = existsSync(join(projectPath, ".aimon", "skills"));

  // 探测 detectedMode：dev-docs anchor / openspec 目录都装了取 dev-docs 优先（与默认行为一致）；
  // 都没装返回 null
  let detectedMode: WorkflowMode | null = null;
  if (devDocs.enabled) detectedMode = "dev-docs";
  else if (openspec.applied !== "none") detectedMode = "openspec";

  // applied 聚合：detectedMode 对应的规范工作流 + harness 都装齐 = full；
  // 只装一边 = partial；都没装 = none
  let applied: WorkflowStatus["applied"];
  const specApplied =
    (detectedMode === "dev-docs" && devDocs.enabled) ||
    (detectedMode === "openspec" && openspec.applied === "full");
  if (specApplied && harnessApplied) applied = "full";
  else if (!detectedMode && !harnessApplied) applied = "none";
  else applied = "partial";

  return {
    detectedMode,
    devDocs,
    openspec,
    harness,
    superpowers,
    applied,
  };
}
