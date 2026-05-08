// Superpowers 工作流提示（分发到目标项目的副本）。
//
// 由 `workflow-service.ts::appendSuperpowersGuidelines` 写入目标项目根的
// `CLAUDE.md`。anchor 是 "# Superpowers 7 步流程"——重写时必须保留首行不变，
// 否则 apply 幂等性失效（已装项目重新 apply 会变成追加而非 no-op）。
//
// **重要边界**：本段只是写给 AI 看的"项目启用了 Superpowers"提示，**真正的
// 流程强制约束在 Claude Code 插件市场安装的 Superpowers 本体**。VibeSpace
// 控不到 Claude Code 插件本身，本段写入只代表"建议 AI 按 7 步走"，不等于
// 插件已安装并生效。Superpowers 浅集成的真实边界详见
// `dev/active/AI开发三件套接入/AI开发三件套接入-plan.md` 风险段 R1。
//
// 修改时请同步更新 `getSuperpowersStatus`（靠 anchor 探测启用状态）。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SUPERPOWERS_ANCHOR = "# Superpowers 7 步流程";

export const SUPERPOWERS_GUIDELINES = `${SUPERPOWERS_ANCHOR}

> 本段由 VibeSpace UI 装配（在「Dev Docs」/ 设置抽屉可卸载/重装更新）。
> **真正的流程强制依赖 Claude Code 插件市场的 Superpowers 本体**——本段只是项目级提示，告诉 AI 按 7 步走；
> 没装 Superpowers 插件时本段不会被强制执行，请在 Claude Code 设置里搜索 "Superpowers" 安装。

本项目启用了 **Superpowers 7 步流程**。在写代码前，AI 应按下面顺序推进，每一步**不可跳过**：

1. **brainstorming（澄清需求）**：苏格拉底式提问把模糊点问清——避免"以为要做 A 实际要做 B"。
2. **git worktree（隔离分支）**：在当前仓库切出一份临时副本干活，不污染主分支。
3. **writing-plans（拆解为 2-5 分钟的小任务）**：每条小任务都能独立验证，AI 不一口气吞 30 分钟的大块。
4. **subagent 执行**：每条小任务派独立子代理，隔离上下文。
5. **TDD 循环**：RED → GREEN → REFACTOR——先写一个失败的测试，再让它通过，最后清理。
6. **代码审查（两阶段）**：先按规范合规性审一遍，再按代码质量审一遍。
7. **finishing-branch（分支收尾）**：跑完整测试、决定合并或丢弃，干净收尾不留债务。

如果你正在使用本项目里另一套规范工作流（例如 Dev Docs 三段式或 OpenSpec proposal/design/tasks），Superpowers 7 步与它们**正交**：规范工作流回答"做什么/给谁验收"，Superpowers 回答"AI 怎么写代码不偷懒"。两套都可以同时启用。

> 提示：未安装 Claude Code Superpowers 插件时，AI 看到这段也会**尝试**按 7 步走，但缺少强制阻断；如希望硬约束，请安装插件本体。
`;

/** 把 Superpowers 引导段追加到目标项目的 CLAUDE.md。已存在则 no-op 返回 false。 */
export function appendSuperpowersGuidelines(projectPath: string): boolean {
  const target = join(projectPath, "CLAUDE.md");
  let existing = "";
  try {
    existing = readFileSync(target, "utf8");
  } catch {
    // CLAUDE.md 不存在——直接 fresh 写
  }
  if (existing.includes(SUPERPOWERS_ANCHOR)) return false;
  const needsSeparator = existing.length > 0;
  const trailingNewlines = existing.endsWith("\n\n")
    ? ""
    : existing.endsWith("\n")
      ? "\n"
      : "\n\n";
  const payload = needsSeparator
    ? `${existing}${trailingNewlines}---\n\n${SUPERPOWERS_GUIDELINES}`
    : SUPERPOWERS_GUIDELINES;
  writeFileSync(target, payload, "utf8");
  return true;
}

export interface RemoveResult {
  changed: boolean;
  reason?: "claude_md_missing" | "anchor_missing";
}

/** 把 VibeSpace 写入的 Superpowers 段精确撤掉；用户手写的同名锚点段不动（只删带固定 separator 的 VibeSpace 写入痕迹）。 */
export function removeSuperpowersGuidelines(projectPath: string): RemoveResult {
  const target = join(projectPath, "CLAUDE.md");
  let content: string;
  try {
    content = readFileSync(target, "utf8");
  } catch {
    return { changed: false, reason: "claude_md_missing" };
  }
  const REMOVE_PREFIX = "\n\n---\n\n" + SUPERPOWERS_ANCHOR;
  const idx = content.indexOf(REMOVE_PREFIX);
  if (idx < 0) {
    // CLAUDE.md 存在但锚点段不是 VibeSpace 写的（可能用户手写过、或本来就没装）——按 idempotent 处理。
    return { changed: false, reason: "anchor_missing" };
  }
  const trimmed = content.slice(0, idx).replace(/\s+$/, "");
  writeFileSync(target, trimmed + "\n", "utf8");
  return { changed: true };
}

/** 探测目标项目是否启用了 Superpowers 段（通过 CLAUDE.md anchor）。 */
export function getSuperpowersStatus(projectPath: string): {
  enabled: boolean;
  claudeMdExists: boolean;
} {
  const target = join(projectPath, "CLAUDE.md");
  if (!existsSync(target)) {
    return { enabled: false, claudeMdExists: false };
  }
  let content = "";
  try {
    content = readFileSync(target, "utf8");
  } catch {
    return { enabled: false, claudeMdExists: false };
  }
  return {
    enabled: content.includes(SUPERPOWERS_ANCHOR),
    claudeMdExists: true,
  };
}
