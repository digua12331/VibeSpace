export interface IssuePromptInput {
  issueText: string;
  issueLine: number;
  issueHash: string;
}

export const ISSUE_DONE_MARKER = "===ISSUE-DONE===";
export const ISSUE_STUCK_MARKER = "===ISSUE-STUCK===";

/**
 * Build the prompt that gets injected into a freshly-spawned claude PTY for
 * an issue-job worktree. Wording mirrors CLAUDE.md "Issues 档案" section so
 * the agent stays on its small-task discipline (no plan/context/tasks files).
 */
export function buildIssuePrompt(input: IssuePromptInput): string {
  return `我已经把 dev/issues.md 第 ${input.issueLine} 行（hash ${input.issueHash.slice(0, 8)}）的修复任务派给你。

原文：
> ${input.issueText}

请按 CLAUDE.md "Issues 档案" 一节的小任务流程执行：
1. 不要走 plan/context/tasks 三段式，直接读相关代码、改、验证
2. 严守"外科式改动"原则 —— 只碰必须碰的，看到无关的死代码就提一嘴不要删
3. 改动如果触发"破坏性变更协议"（删源码 / 改导出符号 / 改路由 / 改 SQLite schema），必须先用 grep 列受影响清单并停手等指示
4. 改完后把 dev/issues.md 里这一行的 \`[ ]\` 改成 \`[x]\`
5. 验证完成后，在终端最后单独打印一行：
   ${ISSUE_DONE_MARKER}
6. 如果连续 2-3 次失败（无法修复 / verify 不通过 / 范围超出 issue 描述的预期），停手并打印一行：
   ${ISSUE_STUCK_MARKER} <一句话原因>
   不要继续改、不要扩大范围、不要修测试用例来凑绿灯

完成或停手后等待 verify pipeline 接管，不要主动退出 session 也不要等待进一步指令。`;
}
