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
 * **mode 概念**：Dev Docs / OpenSpec / spec-trio **项目级三选一**——同一项目同一
 * 时间只装一种"规范工作流"，由调用方传 `opts.mode` 决定（默认 `"dev-docs"`，
 * 与本文件早期版本零参调用行为完全一致）。Harness 与 Superpowers 与 mode 正交：
 * Harness 始终装；Superpowers 只在 `opts.superpowers === true` 时装。
 *
 * **`spec-trio` 预设套餐**：OpenSpec + Superpowers + gstack 三件套。装配等价于
 * `mode='openspec' + 强制 superpowers=true`，再加一次 gstack 装态探测（只检测，
 * 不触发安装——gstack 是机器级 `~/.claude/skills/gstack`，安装走独立路由
 * `/api/external-tools/gstack/*`）。切走 spec-trio 时强制卸 Superpowers anchor，
 * 但 gstack 二进制不动（跨项目共享）。
 *
 * **失败语义**：
 * - apply：第一步（规范工作流：dev-docs **或** openspec）失败直接 abort，
 *   后续不执行；第一步成功而 harness/superpowers 失败时不回滚——`partial: true`
 *   让 UI 明确告知，重试时第一步幂等（anchor / 目录已在 → no-op）。
 * - remove：先卸 Harness 文件，再撤 CLAUDE.md 段；任意一步失败 partial。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorkflowMode } from "./db.js";
import {
  DEV_DOCS_GUIDELINES,
  DEV_DOCS_VERSION,
} from "./dev-docs-guidelines.js";
import { getGstackStatus } from "./gstack-installer.js";
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

// ---------- Dev Docs（独立文件 .aimon/workflow/dev-docs.md + CLAUDE.md @引用）----------

// 老内联形态的 h1 锚点（仅迁移检测用）。必须按"整行"匹配，避免被新形态里
// 别处的 `## ...` 当成子串误命中。
const MAIN_GUIDELINES_ANCHOR = "# Dev Docs 工作流";
const INLINE_ANCHOR_RE = /^# Dev Docs 工作流\s*$/m;

const DEV_DOCS_FILE_REL = ".aimon/workflow/dev-docs.md";
const DEV_DOCS_IMPORT_LINE = "@" + DEV_DOCS_FILE_REL;
const DEV_DOCS_IMPORT_MARKER = "<!-- dev-docs-workflow:import -->";
const DEV_DOCS_IMPORT_BLOCK =
  DEV_DOCS_IMPORT_MARKER + "\n" + DEV_DOCS_IMPORT_LINE;

/** 'none' 未装 / 'inline-legacy' 老内联待迁移 / 'file' 已是独立文件形态 */
export type DevDocsForm = "none" | "inline-legacy" | "file";

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

/** 把 DEV_DOCS_GUIDELINES 母版写到项目的 .aimon/workflow/dev-docs.md（覆盖）。 */
function writeDevDocsFile(projectPath: string): void {
  const dir = join(projectPath, ".aimon", "workflow");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dev-docs.md"), DEV_DOCS_GUIDELINES, "utf8");
}

function deleteDevDocsFile(projectPath: string): void {
  try {
    rmSync(join(projectPath, ".aimon", "workflow", "dev-docs.md"), {
      force: true,
    });
  } catch {
    /* ignore */
  }
}

/** 确保 CLAUDE.md 含 @引用块；已含则 no-op。返回是否改了 CLAUDE.md。 */
function ensureImportBlock(projectPath: string): boolean {
  return appendToClaudeMd(
    projectPath,
    DEV_DOCS_IMPORT_BLOCK,
    DEV_DOCS_IMPORT_LINE,
  );
}

/** 装配：写独立文件 + 确保引用块（替代旧的"内联整段进 CLAUDE.md"）。 */
function appendDevDocsGuidelines(projectPath: string): boolean {
  writeDevDocsFile(projectPath);
  return ensureImportBlock(projectPath);
}

function parseDevDocsVersion(text: string): number | null {
  const m = /<!--\s*dev-docs-workflow:v(\d+)\s*-->/.exec(text);
  return m ? Number(m[1]) : null;
}

function readDevDocsFileVersion(projectPath: string): number | null {
  try {
    const txt = readFileSync(
      join(projectPath, ".aimon", "workflow", "dev-docs.md"),
      "utf8",
    );
    return parseDevDocsVersion(txt);
  } catch {
    return null;
  }
}

/** 老内联块范围 [start,end)：h1 锚点起，到下一 `\n\n---\n\n#` 或 EOF（安全边界，不吃相邻段）。 */
function findInlineBlockRange(
  content: string,
): { start: number; end: number } | null {
  const m = INLINE_ANCHOR_RE.exec(content);
  if (!m) return null;
  const start = m.index;
  const NEXT_SECTION = "\n\n---\n\n#";
  const nextIdx = content.indexOf(NEXT_SECTION, start + m[0].length);
  const end = nextIdx < 0 ? content.length : nextIdx;
  return { start, end };
}

/** 删掉 [start,end) 区域，并连带吃掉它前面的一个 `\n\n---\n\n` 分隔，避免留下孤立 `---`。 */
function cutRegionWithLeadingSep(
  content: string,
  start: number,
  end: number,
): string {
  const SEP = "\n\n---\n\n";
  let s = start;
  if (content.slice(0, s).endsWith(SEP)) s -= SEP.length;
  const out = content.slice(0, s) + content.slice(end);
  return out.replace(/\s+$/, "") + "\n";
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

  if (content.includes(DEV_DOCS_IMPORT_LINE)) {
    // file 形态：删引用块（marker 行 + @行）+ 删独立文件
    const lineIdx = content.indexOf(DEV_DOCS_IMPORT_LINE);
    const markerIdx = content.lastIndexOf(DEV_DOCS_IMPORT_MARKER, lineIdx);
    const start = markerIdx >= 0 && markerIdx < lineIdx ? markerIdx : lineIdx;
    let end = content.indexOf("\n", lineIdx);
    if (end < 0) end = content.length;
    const next = cutRegionWithLeadingSep(content, start, end);
    writeFileSync(target, next, "utf8");
    deleteDevDocsFile(projectPath);
    return { changed: true };
  }

  // inline-legacy 形态：删内联块（安全边界）
  const range = findInlineBlockRange(content);
  if (range) {
    const next = cutRegionWithLeadingSep(content, range.start, range.end);
    writeFileSync(target, next, "utf8");
    deleteDevDocsFile(projectPath);
    return { changed: true };
  }

  return { changed: false, reason: "anchor_missing" };
}

function getDevDocsStatus(projectPath: string): {
  enabled: boolean;
  claudeMdExists: boolean;
  form: DevDocsForm;
  installedVersion: number | null;
  currentVersion: number;
  outdated: boolean;
} {
  const target = join(projectPath, "CLAUDE.md");
  let claudeMdExists = true;
  let content = "";
  try {
    content = readFileSync(target, "utf8");
  } catch {
    claudeMdExists = false;
  }

  let form: DevDocsForm = "none";
  if (claudeMdExists && content.includes(DEV_DOCS_IMPORT_LINE)) {
    form = "file";
  } else if (claudeMdExists && INLINE_ANCHOR_RE.test(content)) {
    form = "inline-legacy";
  }

  // file 形态版本读独立文件戳；inline-legacy 读 CLAUDE.md 内联戳（兼容上一版 v1 内联）。
  let installedVersion: number | null = null;
  if (form === "file") installedVersion = readDevDocsFileVersion(projectPath);
  else if (form === "inline-legacy")
    installedVersion = parseDevDocsVersion(content);

  // inline-legacy 永远视为"待迁移"（outdated=true）；file 形态戳低于当前 → outdated。
  const outdated =
    form === "inline-legacy" ||
    (form === "file" &&
      (installedVersion === null || installedVersion < DEV_DOCS_VERSION));

  return {
    enabled: form !== "none",
    claudeMdExists,
    form,
    installedVersion,
    currentVersion: DEV_DOCS_VERSION,
    outdated,
  };
}

// ---------- 聚合 API ----------

export interface WorkflowApplyOptions {
  /** 规范工作流模式；默认 "dev-docs"（保留零参兼容）。 */
  mode?: WorkflowMode;
  /** 是否同时装 Superpowers 7 步流程提示段。spec-trio 模式忽略此字段，强制装。 */
  superpowers?: boolean;
}

export interface WorkflowRemoveOptions {
  /** 撤掉哪种规范工作流；默认 "dev-docs"。 */
  mode?: WorkflowMode;
  /** 是否同时撤 Superpowers 段。spec-trio 模式忽略此字段，强制撤。 */
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
  /** Superpowers 子结果；仅 superpowers === true 或 mode === "spec-trio" 时存在。 */
  superpowers:
    | null
    | { ok: true; wrote: boolean }
    | { ok: false; error: string };
  /**
   * gstack 装态探测子结果；仅 mode === "spec-trio" 时存在，其余为 null。
   * 只读不安装——gstack 是机器级 `~/.claude/skills/gstack`，安装走独立路由。
   * `installed === false` 会导致 partial=true，前端弹"gstack 未装"专项提示。
   */
  gstack: null | { installed: boolean };
  /**
   * 一致性标志：
   * - `false`：所有应跑步骤都成功 / 第一步失败 abort（状态干净）；
   * - `true`：第一步成功但 harness/superpowers/gstack 任一未达 → CLAUDE.md/目录已写入但配套未装全。
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
  /**
   * gstack 装态探测子结果；仅 mode === "spec-trio" 时存在。
   * 切走 spec-trio 不卸 gstack 二进制（跨项目共享），仅返回当前装态供前端展示。
   */
  gstack: null | { installed: boolean };
  partial: boolean;
}

export interface WorkflowStatus {
  /**
   * 探测出的当前规范工作流。
   * - `spec-trio`：db 持久化 `workflowMode==='spec-trio'` **且** openspec 目录在 **且**
   *   Superpowers anchor 在——三者全满足时返回（磁盘上 spec-trio 与 openspec+Superpowers
   *   完全同形，必须靠 db 字段做意图层判定）。
   * - `dev-docs` / `openspec`：按磁盘探测降级（dev-docs anchor 优先，否则 openspec 目录）。
   * - `null`：未应用任何规范工作流。
   */
  detectedMode: WorkflowMode | null;
  devDocs: {
    enabled: boolean;
    claudeMdExists: boolean;
    /** 'none' 未装 / 'inline-legacy' 老内联待迁移 / 'file' 已是独立文件形态。 */
    form: DevDocsForm;
    /** 已装的版本号（file 形态读独立文件戳；inline-legacy 读内联戳）；无戳为 null。 */
    installedVersion: number | null;
    /** 当前母版版本号（DEV_DOCS_VERSION）。 */
    currentVersion: number;
    /** inline-legacy 一律 true（待迁移）；file 形态戳低于当前 → true。 */
    outdated: boolean;
  };
  openspec: OpenSpecStatus;
  harness: HarnessStatus;
  superpowers: { enabled: boolean; claudeMdExists: boolean };
  /** gstack 机器级装态（探测 `~/.claude/skills/gstack/.git` 目录）。 */
  gstack: { installed: boolean };
  /**
   * 聚合状态（基于 detectedMode 对应的规范工作流 + harness + spec-trio 模式下的 gstack）：
   * - `none` —— 都未应用；
   * - `partial` —— 只装了一部分；
   * - `full` —— 全部装齐。
   * 由前端决定按钮文案与状态徽章。
   */
  applied: "none" | "partial" | "full";
}

export async function applyWorkflowToProject(
  projectPath: string,
  opts: WorkflowApplyOptions = {},
): Promise<WorkflowApplyResult> {
  const mode: WorkflowMode = opts.mode ?? "dev-docs";
  // spec-trio 是预设套餐，强制带 Superpowers（忽略 opts.superpowers）
  const superpowersOn = opts.superpowers === true || mode === "spec-trio";
  // spec-trio 在装配第一步上与 openspec 完全相同（同一份 scaffold）
  const useOpenSpecScaffold = mode === "openspec" || mode === "spec-trio";

  // Step 1: 规范工作流（dev-docs anchor 或 OpenSpec scaffold）
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
        gstack: null,
        partial: false,
      };
    }
  } else if (useOpenSpecScaffold) {
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
        gstack: null,
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

  // Step 3: Superpowers（可选 / spec-trio 强制）
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

  // Step 4: gstack 装态探测（仅 spec-trio）—— 只读不安装；未装即标 partial
  // 让前端弹"gstack 未装"专项提示，引导用户去 Tools tab 单独装。
  let gstackResult: WorkflowApplyResult["gstack"] = null;
  if (mode === "spec-trio") {
    try {
      const s = await getGstackStatus();
      gstackResult = { installed: s.installed };
      if (!s.installed) partial = true;
    } catch {
      // 探测失败按未装处理（不阻塞 apply 主流程）
      gstackResult = { installed: false };
      partial = true;
    }
  }

  return {
    mode,
    devDocs: devDocsResult,
    openspec: openspecResult,
    harness: harnessResult,
    superpowers: superpowersResult,
    gstack: gstackResult,
    partial,
  };
}

export async function removeWorkflowFromProject(
  projectPath: string,
  opts: WorkflowRemoveOptions = {},
): Promise<WorkflowRemoveResult> {
  const mode: WorkflowMode = opts.mode ?? "dev-docs";
  // spec-trio 是预设套餐，强制卸 Superpowers（忽略 opts.superpowers）
  const superpowersOff = opts.superpowers === true || mode === "spec-trio";
  const useOpenSpecScaffold = mode === "openspec" || mode === "spec-trio";

  // 顺序反向：先卸 Harness 文件，再撤 CLAUDE.md 段 / OpenSpec 目录。
  // 文件清理失败时仍然继续撤 CLAUDE.md 段，failedFiles 透传给前端展示。
  const harnessResult = await uninstallHarnessTemplate(projectPath);

  let devDocsResult: WorkflowRemoveResult["devDocs"] = null;
  let openspecResult: WorkflowRemoveResult["openspec"] = null;
  if (mode === "dev-docs") {
    devDocsResult = removeDevDocsGuidelines(projectPath);
  } else if (useOpenSpecScaffold) {
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

  // spec-trio 切走时 gstack 二进制不动（跨项目共享），仅探测当前装态供前端展示。
  let gstackResult: WorkflowRemoveResult["gstack"] = null;
  if (mode === "spec-trio") {
    try {
      const s = await getGstackStatus();
      gstackResult = { installed: s.installed };
    } catch {
      gstackResult = { installed: false };
    }
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
    gstack: gstackResult,
    partial,
  };
}

/**
 * 探测项目工作流状态。
 *
 * @param projectPath 项目根路径
 * @param persistedMode db 持久化的用户意图（projects.json 真源；由调用方从
 *   `getProject(id).workflowMode` 取并传入）。spec-trio 在磁盘上与 openspec+Superpowers
 *   完全同形，必须靠这个字段做意图层判定——若磁盘三件套齐 + persistedMode='spec-trio'，
 *   detectedMode 返回 'spec-trio'；否则按纯磁盘探测降级。
 */
export async function getWorkflowStatus(
  projectPath: string,
  persistedMode: WorkflowMode | null = null,
): Promise<WorkflowStatus> {
  const devDocs = getDevDocsStatus(projectPath);
  const openspec = await getOpenSpecStatus(projectPath);
  const harness = await getHarnessStatus(projectPath);
  const superpowers = getSuperpowersStatus(projectPath);
  const gstack = await getGstackStatus().then(
    (s) => ({ installed: s.installed }),
    () => ({ installed: false }),
  );
  const harnessApplied = existsSync(join(projectPath, ".aimon", "skills"));

  // 探测 detectedMode：
  // 1. spec-trio：persistedMode 标记 + 磁盘上 openspec scaffold 在 + Superpowers anchor 在
  // 2. 否则按磁盘探测降级（dev-docs anchor 优先，openspec 目录次之，null 兜底）
  let detectedMode: WorkflowMode | null = null;
  if (
    persistedMode === "spec-trio" &&
    openspec.applied !== "none" &&
    superpowers.enabled
  ) {
    detectedMode = "spec-trio";
  } else if (devDocs.enabled) {
    detectedMode = "dev-docs";
  } else if (openspec.applied !== "none") {
    detectedMode = "openspec";
  }

  // applied 聚合：
  // - spec-trio 模式 full = openspec 完整 + Superpowers anchor 在 + harness 装齐 + gstack 已装
  // - dev-docs / openspec 模式 full = 对应规范装齐 + harness 装齐
  // - 其余：都未装 = none；只装一部分 = partial
  let applied: WorkflowStatus["applied"];
  let specApplied: boolean;
  if (detectedMode === "spec-trio") {
    specApplied =
      openspec.applied === "full" &&
      superpowers.enabled &&
      harnessApplied &&
      gstack.installed;
    applied = specApplied ? "full" : "partial";
  } else {
    specApplied =
      (detectedMode === "dev-docs" && devDocs.enabled) ||
      (detectedMode === "openspec" && openspec.applied === "full");
    if (specApplied && harnessApplied) applied = "full";
    else if (!detectedMode && !harnessApplied) applied = "none";
    else applied = "partial";
  }

  return {
    detectedMode,
    devDocs,
    openspec,
    harness,
    superpowers,
    gstack,
    applied,
  };
}

// ---------- Dev Docs 母版统一对齐（迁移到独立文件 + 更新；单项目 + 批量） ----------

export interface DevDocsUpdateResult {
  /** 本次是否真改了东西（已是最新文件形态或未装 → false）。 */
  changed: boolean;
  reason?: "claude_md_missing";
  /** 对齐后的形态。 */
  form: DevDocsForm;
  /** 做了什么：迁移(老内联→独立文件) / 更新(覆盖独立文件) / 无操作。 */
  action: "migrate" | "update" | "noop";
  installedVersion: number | null;
  currentVersion: number;
}

/**
 * 把单个项目对齐到"最新独立文件形态"：
 * - inline-legacy → 移除内联块、改成 @引用块、落下独立文件（迁移）
 * - file → 覆盖独立文件 + 自愈引用块（更新）
 * - none → no-op
 *
 * 只动 Dev Docs 工作流相关部分（内联块 / 引用块 / 独立文件），CLAUDE.md 其余内容保留。
 */
export function updateProjectDevDocs(projectPath: string): DevDocsUpdateResult {
  const st = getDevDocsStatus(projectPath);
  const tail = { currentVersion: DEV_DOCS_VERSION };

  if (st.form === "none") {
    return {
      changed: false,
      form: "none",
      action: "noop",
      installedVersion: null,
      ...tail,
    };
  }

  if (st.form === "file") {
    // 覆盖独立文件 + 确保引用块在（自愈）
    writeDevDocsFile(projectPath);
    ensureImportBlock(projectPath);
    return {
      changed: true,
      form: "file",
      action: "update",
      installedVersion: DEV_DOCS_VERSION,
      ...tail,
    };
  }

  // inline-legacy → 迁移：内联块替换成引用块 + 落下独立文件
  const target = join(projectPath, "CLAUDE.md");
  let content: string;
  try {
    content = readFileSync(target, "utf8");
  } catch {
    return {
      changed: false,
      reason: "claude_md_missing",
      form: "inline-legacy",
      action: "noop",
      installedVersion: null,
      ...tail,
    };
  }
  const range = findInlineBlockRange(content);
  if (!range) {
    return {
      changed: false,
      form: "none",
      action: "noop",
      installedVersion: null,
      ...tail,
    };
  }
  const before = content.slice(0, range.start);
  const after = content.slice(range.end);
  const rebuilt = after
    ? `${before}${DEV_DOCS_IMPORT_BLOCK}${after}`
    : `${before}${DEV_DOCS_IMPORT_BLOCK}\n`;
  writeFileSync(target, rebuilt, "utf8");
  writeDevDocsFile(projectPath);
  return {
    changed: true,
    form: "file",
    action: "migrate",
    installedVersion: DEV_DOCS_VERSION,
    ...tail,
  };
}

export interface RefreshAllResult {
  updated: {
    id: string;
    name: string;
    action: "migrate" | "update";
    from: number | null;
    to: number;
  }[];
  skipped: {
    id: string;
    name: string;
    reason: "up-to-date" | "not-installed" | "no-claude-md";
  }[];
}

/**
 * 遍历传入项目，按形态分派：inline-legacy 必迁移、file 仅 outdated 才覆盖、其余跳过。
 * 项目清单由调用方（路由层）从 listProjects() 取并剔除 __hub__ 后传入，便于测试与解耦 db。
 */
export function refreshAllOutdatedDevDocs(
  projects: { id: string; name: string; path: string }[],
): RefreshAllResult {
  const updated: RefreshAllResult["updated"] = [];
  const skipped: RefreshAllResult["skipped"] = [];
  for (const p of projects) {
    const st = getDevDocsStatus(p.path);
    if (st.form === "none") {
      skipped.push({
        id: p.id,
        name: p.name,
        reason: st.claudeMdExists ? "not-installed" : "no-claude-md",
      });
      continue;
    }
    if (st.form === "file" && !st.outdated) {
      skipped.push({ id: p.id, name: p.name, reason: "up-to-date" });
      continue;
    }
    const from = st.installedVersion;
    const r = updateProjectDevDocs(p.path);
    if (r.changed && (r.action === "migrate" || r.action === "update")) {
      updated.push({
        id: p.id,
        name: p.name,
        action: r.action,
        from,
        to: DEV_DOCS_VERSION,
      });
    } else {
      skipped.push({ id: p.id, name: p.name, reason: "not-installed" });
    }
  }
  return { updated, skipped };
}
