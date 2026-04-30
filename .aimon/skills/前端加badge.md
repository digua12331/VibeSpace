---
triggers: [badge, 标签, 前缀, 标记, chip, pill]
---

# 前端 badge / chip 配色与放置约定

## 颜色调色板（已被使用，**不要发明新颜色**）

| 颜色 | 语义 | 已用于 |
|---|---|---|
| **cyan**（`text-cyan-300/90 bg-cyan-400/10 border-cyan-400/30`）| 任务绑定 / 资源链接 | 📝 task / 🔗 task-binding |
| **emerald**（`text-emerald-300/90 bg-emerald-400/10 border-emerald-400/30`）| 隔离 / 安全态 | 🌿 worktree / ✓ done |
| **violet**（`text-violet-300/90 bg-violet-400/10 border-violet-400/30`）| subagent / 子工 | 🤖 subagent / 📌 subagent run chip |
| **amber**（`text-amber-300/90 bg-amber-400/10 border-amber-400/30`）| 警告态 / 受限 | 🛡 scope / 进行中 |
| **rose**（`text-rose-300/90 bg-rose-500/15 border-rose-500/40`）| 危险 / 失败 | ✕ delete / 阻塞 / 失败 pill |

## EditorArea 标签内 badge 顺序约定

session 标签从左到右：

```
agentIcon → 📝 task badge → 🌿 worktree badge → 🤖×N subagent badge → agent·id6 → scope badge
```

排序逻辑：**语义层 > 实现层 > 进程层 > 标识层 > 约束层**。不要打乱这个顺序。

## badge HTML 模板（IIFE 包条件渲染）

```tsx
{(() => {
  const matched = ...
  if (!matched) return null
  return (
    <span
      title="hover 提示文案"
      className="text-[10px] text-{color}-300/90 bg-{color}-400/10 border border-{color}-400/30 rounded px-1 py-0 leading-4 whitespace-pre"
    >
      {emoji} {label}
    </span>
  )
})()}
```

字段：
- `text-[10px]` 字号统一 10px
- `px-1 py-0 leading-4` 紧凑高度
- `whitespace-pre` 防止多语言空格被吞
- `title` 必填（hover 看到完整信息）

## 文本截断

label 太长用 `.slice(0, N) + '…'`，N 取：
- task 名：10
- worktree branch：去掉 `agent/` 前缀后全显
- subagent description：12

## SessionView chip bar（顶栏下方独立行）

跟 EditorArea 标签内 badge **不**一样——chip bar 是 SessionView 顶部的横排卡片，每个 chip 是 button 可点击 → alertDialog 显示详情。参考 `subagent runs chips bar` 在 SessionView 里的实现：

```tsx
{items.length > 0 && (
  <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/40 bg-{color}-500/[0.04] overflow-x-auto whitespace-nowrap">
    <span className="text-[10px] text-{color}-300/80 shrink-0 mr-1">
      {emoji} {category}:
    </span>
    {items.slice(0, 10).map((it) => ...)}
    {items.length > 10 && <span className="text-[10px] text-subtle">+{items.length - 10}</span>}
  </div>
)}
```

10 个上限、超出显示 `+N`、整行滚动条。

## 不适用

- 标签颜色单纯做分类（不是状态）→ 用 monochrome 字号 / 字重区分，不要再吃配色
- 详情弹窗用 alertDialog / confirmDialog（DialogHost），**不要**自己写 fixed div
- 不要在 LogsView / SCM 里加自定义 badge——这两个视图有自己的 row 渲染规则
