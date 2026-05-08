// OpenSpec 工作流装配（在目标项目里建 OpenSpec 标准目录骨架）。
//
// 由 `workflow-service.ts` 在 `mode === "openspec"` 时调用。OpenSpec 的标准
// 模型是双文件夹 `openspec/specs/` + `openspec/changes/`，每个 change 含
// proposal.md / design.md / tasks.md（参考用户提供文档）。本实现自写骨架而
// 不调用 `npx openspec init`——理由详见 plan D1：减少外部 npm 依赖。
//
// **schema 升级风险**：若 OpenSpec 官方升级 schema（例如新增必备文件、改目录
// 名），本文件写出的骨架会与官方漂移。维护时核对 OpenSpec 官方仓库 README
// 的"双文件夹模型"段。
//
// 与 harness-template-service 的差别：harness 是把仓库内文件**拷贝**到目标
// 项目，OpenSpec 骨架是凭空创建（不存在源文件），所以本文件用 mkdir + writeFile
// 而不是 readdir + copyFile manifest。

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface OpenSpecApplyResult {
  /** 新建的目录与文件（相对项目根的 POSIX 路径）。 */
  created: string[];
  /** 已存在被跳过的（apply 幂等）。 */
  skipped: string[];
}

export interface OpenSpecUninstallResult {
  removedCount: number;
  /** 因含用户内容（changes 子目录非空且不属于初始骨架）而保留的；告知前端避免误删。 */
  preservedPaths: string[];
  failedPaths: string[];
}

export interface OpenSpecStatus {
  /** 项目里 `openspec/` 目录是否存在。 */
  rootExists: boolean;
  /** specs/ + changes/ + AGENTS.md 都齐全才算 full；缺任一为 partial；都没有为 none。 */
  applied: "none" | "partial" | "full";
  /** 如果有 changes/，列出 change 子目录数（只数顶层，不递归）。给前端展示用。 */
  changesCount: number;
}

/** OpenSpec 标准 AGENTS.md 简版：告诉读它的 AI 这个项目用 OpenSpec 工作流。
 *  内容刻意简短，避免与项目根 CLAUDE.md 重复；用户可自行扩写。 */
const OPENSPEC_AGENTS_MD = `# OpenSpec 工作流

> 本文件由 VibeSpace UI 装配。\`openspec/\` 是当前项目的"规范驱动开发"工作目录。

## 双文件夹模型

- \`openspec/specs/\` —— 当前系统的事实来源（什么是已存在/已稳定的规范）
- \`openspec/changes/\` —— 每次"变更提案"的完整三件套（提议/设计/任务）

## 每份变更必须包含三个文件

- \`proposal.md\` —— 为什么要做（背景、目标、成功标准、不做会怎样）
- \`design.md\` —— 技术方案（架构决策、接口设计、数据流、依赖关系）
- \`tasks.md\` —— 实施清单（可执行的具体任务）

## 工作流要求

1. **规范先行**：任何代码变更前先在 \`openspec/changes/<变更名>/\` 下补齐 proposal + design + tasks 三件套
2. **保持文件分离**：不要把代码、提交日志、临时笔记混进规范文件
3. **历史归档**：变更完成后整体移动到 \`openspec/archive/<变更名>-<时间戳>/\`
`;

/** 项目根下需要创建的目录骨架（相对路径用 POSIX）。 */
const OPENSPEC_DIRS = [
  "openspec",
  "openspec/specs",
  "openspec/changes",
  "openspec/archive",
] as const;

/** 项目根下需要创建的文件骨架。 */
const OPENSPEC_FILES: Array<{ rel: string; content: string }> = [
  { rel: "openspec/AGENTS.md", content: OPENSPEC_AGENTS_MD },
  // .gitkeep —— 让空 specs/ 目录在 git add . 时也能被纳入版本控制
  { rel: "openspec/specs/.gitkeep", content: "" },
];

/** 创建 OpenSpec 标准骨架；已存在的目录/文件跳过（幂等）。 */
export async function applyOpenSpecTemplate(
  projectPath: string,
): Promise<OpenSpecApplyResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const dir of OPENSPEC_DIRS) {
    const abs = join(projectPath, dir);
    if (existsSync(abs)) {
      skipped.push(dir);
      continue;
    }
    await mkdir(abs, { recursive: true });
    created.push(dir);
  }

  for (const file of OPENSPEC_FILES) {
    const abs = join(projectPath, file.rel);
    if (existsSync(abs)) {
      skipped.push(file.rel);
      continue;
    }
    await writeFile(abs, file.content, "utf8");
    created.push(file.rel);
  }

  return { created, skipped };
}

/**
 * 卸载 OpenSpec 骨架：
 * - 只删 VibeSpace 写入的固定骨架文件（AGENTS.md / .gitkeep）；
 * - 只删骨架目录（specs / changes / archive）**当且仅当目录为空**；
 * - 用户写的 changes/ 子目录、specs/ 文件保留并报告 `preservedPaths`，
 *   避免一刀切误删——参考 auto.md 2026-05-01 工作流入口形态对齐经验。
 */
export async function uninstallOpenSpecTemplate(
  projectPath: string,
): Promise<OpenSpecUninstallResult> {
  let removedCount = 0;
  const preservedPaths: string[] = [];
  const failedPaths: string[] = [];

  // 先删固定文件
  for (const file of OPENSPEC_FILES) {
    const abs = join(projectPath, file.rel);
    if (!existsSync(abs)) continue;
    try {
      await rm(abs, { force: true });
      removedCount += 1;
    } catch {
      failedPaths.push(file.rel);
    }
  }

  // 再处理目录：只有为空才删
  // 顺序由内到外（specs / changes / archive 在 openspec 之前）
  const orderedForRemoval = [
    "openspec/specs",
    "openspec/changes",
    "openspec/archive",
    "openspec",
  ];
  for (const dir of orderedForRemoval) {
    const abs = join(projectPath, dir);
    if (!existsSync(abs)) continue;
    try {
      const items = await readdir(abs);
      if (items.length > 0) {
        preservedPaths.push(dir);
        continue;
      }
      await rm(abs, { recursive: false, force: true });
      removedCount += 1;
    } catch {
      failedPaths.push(dir);
    }
  }

  return { removedCount, preservedPaths, failedPaths };
}

export async function getOpenSpecStatus(
  projectPath: string,
): Promise<OpenSpecStatus> {
  const rootAbs = join(projectPath, "openspec");
  const rootExists = existsSync(rootAbs);
  if (!rootExists) {
    return { rootExists: false, applied: "none", changesCount: 0 };
  }
  const specsExists = existsSync(join(projectPath, "openspec/specs"));
  const changesExists = existsSync(join(projectPath, "openspec/changes"));
  const agentsExists = existsSync(join(projectPath, "openspec/AGENTS.md"));

  let changesCount = 0;
  if (changesExists) {
    try {
      const items = await readdir(join(projectPath, "openspec/changes"), { withFileTypes: true });
      changesCount = items.filter((it) => it.isDirectory()).length;
    } catch {
      changesCount = 0;
    }
  }

  let applied: OpenSpecStatus["applied"];
  if (specsExists && changesExists && agentsExists) applied = "full";
  else applied = "partial";

  return { rootExists: true, applied, changesCount };
}

// ---------- changes CRUD（被 routes/openspec.ts 调用） ----------

export interface OpenSpecChangeFiles {
  proposal: boolean;
  design: boolean;
  tasks: boolean;
}

export interface OpenSpecChangeMeta {
  name: string;
  files: OpenSpecChangeFiles;
  /** 三个文件的最近修改时间（毫秒）；不存在则 0。 */
  updatedAt: number;
}

export type OpenSpecChangeFile = "proposal" | "design" | "tasks";

const CHANGE_FILE_NAMES: Record<OpenSpecChangeFile, string> = {
  proposal: "proposal.md",
  design: "design.md",
  tasks: "tasks.md",
};

/** 列出 `openspec/changes/` 下所有 change 子目录及其三件套存在情况。 */
export async function listOpenSpecChanges(
  projectPath: string,
): Promise<OpenSpecChangeMeta[]> {
  const changesDir = join(projectPath, "openspec/changes");
  if (!existsSync(changesDir)) return [];
  const items = await readdir(changesDir, { withFileTypes: true });
  const out: OpenSpecChangeMeta[] = [];
  for (const item of items) {
    if (!item.isDirectory()) continue;
    const subDir = join(changesDir, item.name);
    const files: OpenSpecChangeFiles = {
      proposal: existsSync(join(subDir, "proposal.md")),
      design: existsSync(join(subDir, "design.md")),
      tasks: existsSync(join(subDir, "tasks.md")),
    };
    let updatedAt = 0;
    for (const fileName of ["proposal.md", "design.md", "tasks.md"]) {
      const filePath = join(subDir, fileName);
      if (!existsSync(filePath)) continue;
      try {
        const stat = (await import("node:fs/promises")).stat;
        const s = await stat(filePath);
        if (s.mtimeMs > updatedAt) updatedAt = s.mtimeMs;
      } catch {
        // ignore
      }
    }
    out.push({ name: item.name, files, updatedAt });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** 在 `openspec/changes/<name>/` 下建三件套骨架；已存在直接抛错（防同名覆盖）。 */
export async function createOpenSpecChange(
  projectPath: string,
  name: string,
): Promise<void> {
  const subDir = join(projectPath, "openspec/changes", name);
  if (existsSync(subDir)) {
    throw new Error("change_exists");
  }
  await mkdir(subDir, { recursive: true });
  const skeleton: Record<string, string> = {
    "proposal.md": `# ${name} · proposal\n\n## 背景\n\n## 目标\n\n## 成功标准\n\n## 不做会怎样\n`,
    "design.md": `# ${name} · design\n\n## 架构决策\n\n## 接口/数据流\n\n## 依赖关系\n`,
    "tasks.md": `# ${name} · tasks\n\n- [ ] 任务 1 → verify: ...\n- [ ] 任务 2 → verify: ...\n`,
  };
  for (const [fileName, content] of Object.entries(skeleton)) {
    await writeFile(join(subDir, fileName), content, "utf8");
  }
}

/** 读取某个 change 的某个文件原文。文件不存在时返回 null。 */
export async function readOpenSpecChangeFile(
  projectPath: string,
  name: string,
  file: OpenSpecChangeFile,
): Promise<string | null> {
  const abs = join(projectPath, "openspec/changes", name, CHANGE_FILE_NAMES[file]);
  if (!existsSync(abs)) return null;
  return await readFile(abs, "utf8");
}

/** 写某个 change 的某个文件；目录不存在直接抛错（要求先 createOpenSpecChange）。 */
export async function writeOpenSpecChangeFile(
  projectPath: string,
  name: string,
  file: OpenSpecChangeFile,
  content: string,
): Promise<void> {
  const subDir = join(projectPath, "openspec/changes", name);
  if (!existsSync(subDir)) {
    throw new Error("change_not_found");
  }
  await writeFile(join(subDir, CHANGE_FILE_NAMES[file]), content, "utf8");
}

/** 把整个 change 目录移到 `openspec/archive/<name>-<时间戳>/`。 */
export async function archiveOpenSpecChange(
  projectPath: string,
  name: string,
): Promise<{ archivedTo: string }> {
  const src = join(projectPath, "openspec/changes", name);
  if (!existsSync(src)) {
    throw new Error("change_not_found");
  }
  const archiveRoot = join(projectPath, "openspec/archive");
  await mkdir(archiveRoot, { recursive: true });
  const stamp = formatTimestamp(new Date());
  const dst = join(archiveRoot, `${name}-${stamp}`);
  const { rename } = await import("node:fs/promises");
  await rename(src, dst);
  // 返回相对项目根的路径（用 POSIX 风格让前端拼接稳定）
  return { archivedTo: `openspec/archive/${name}-${stamp}` };
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}
