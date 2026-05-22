---
triggers: [捞需求, github issue, gh issue, 用户反馈 issue, enhancement issue]
---

# 捞需求 · 从 GitHub 拉 issue

产品自闭环第 1 步：用 GitHub CLI（`gh`）拉取 open 的用户反馈，挑一个高优 issue 作为本次闭环目标。数据契约见 `产品自闭环-总纲`。

## 前置依赖

- `gh` 已安装且已 `gh auth login` 登录。
  - token（GitHub 给的访问口令）存在系统凭证保险箱里，调 `gh` 命令时它自己取用，**你不会也不需要接触 token 明文**。
  - 如果 `gh` 未登录，命令会报错 —— 把报错原文告诉大哥，让他先 `gh auth login`，不要自己尝试别的登录方式。

## 拉取最新需求

PowerShell（本机是 Windows，优先用这个）：

```powershell
gh issue list --state open --label "enhancement" --json number,title,body,comments | ConvertFrom-Json
```

Bash：

```bash
gh issue list --state open --label "enhancement" --json number,title,body,comments
```

输出是 JSON 数组，每条含 `number` / `title` / `body` / `comments`。

## 读某个 issue 的完整讨论

```
gh issue view <N> --comments
```

## 你要做的判断

- 拿到 issue 列表后，自己过滤掉无意义的吐槽、重复项、已过时的条目。
- 挑一个**明确、可在一次改动里完成**的高优 issue，记下它的编号 `<N>`。
- 把你选了哪个、为什么选它，简要告诉大哥。
- 选定后进入第 2 步 `本地实现-切分支改代码`，全程沿用这个 `<N>`。

## 失败处理

- `gh` 命令失败 → 把 stderr 原文抛给大哥，不要自动重试、不要伪造 issue 列表。
- 一个 issue 都没有 → 告诉大哥当前没有 open 的 enhancement issue，闭环到此为止。
