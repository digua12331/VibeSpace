---
triggers: [发布更新, 提 pr, 发布视频, 社交平台发布]
---

# 发布 · 提 PR + 社交平台

产品自闭环第 4 步：push 分支、提 PR、（人工确认后）发演示视频、评论并关闭 issue。数据契约见 `产品自闭环-总纲`。

## 红线：发布前必须人工确认（不可绕过）

本步骤的所有命令都会产生**对外可见、难以撤回**的结果（代码推到远端、PR 公开、视频上传到 B 站/YouTube）。因此，在执行 `git push` / `gh pr create` / 发视频命令**之前**，你必须：

1. 把将要执行的**完整命令原文**打印在回复里；
2. **停下来**，明确请大哥回复确认（例如「确认 push 并提 PR 吗？」）；
3. 得到大哥明确同意后才执行那一条命令。

**你不准自己替大哥决定、不准自己输入 y、不准跳过确认。** 一次确认只对应你刚打印的那一条命令；下一条要再确认一次。

建议把"待发布"的命令先写进本次任务的 `tasks.md` 作为待办项，由大哥勾选后再执行 —— 这样确认动作有据可查。

## 步骤

### 4.1 push + 提 PR（确认后执行）

```
git push -u origin feat-ai-issue-<N>
gh pr create --title "AI 自动实现: <issue 标题>" --body "Closes #<N>

<自动生成的更新说明>
演示视频：.aimon/artifacts/issue-<N>/demo.mp4"
```

PR body 必须含 `Closes #<N>` —— 这样 PR 合并时 GitHub 会自动关闭该 issue。

### 4.2 发演示视频（确认后执行）

调用大哥自备的发布脚本（VibeSpace / 本 skill 不替你写 B 站/YouTube 上传代码 —— 涉及账号风险）：

```
python publish_social.py <项目根>/.aimon/artifacts/issue-<N>/demo.mp4 "来看最新更新：<一句话文案>"
```

- 如果 `publish_social.py` 不存在 → 告诉大哥「发布脚本未找到，跳过社交平台发布」，**不要伪造成功**，继续做 4.3。

### 4.3 闭环回复 issue

视频发布成功后：

```
gh issue comment <N> --body "已实现并发布！PR: <PR 链接>  演示视频: <视频链接>"
```

PR body 里写了 `Closes #<N>` 的话，issue 会在 PR 合并时自动关闭。如果需要立即关闭：

```
gh issue close <N>
```

## 失败处理

- 任何命令失败 → 把 stderr 抛给大哥，不要重试、不要继续往下走。
