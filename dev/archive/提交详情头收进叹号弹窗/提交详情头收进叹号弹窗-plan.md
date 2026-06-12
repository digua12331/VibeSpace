# 提交详情头收进叹号弹窗 · Plan

## 大哥摘要

现在你在提交图里点某次提交，编辑区会开一个「提交详情」标签，**最上面有一大块提交信息**（提交说明、作者、时间、哈希、正文），占掉不少高度。这次把那一块**从页面上拿掉**，改成一个小小的**叹号图标（❗）**，平时不占地方，你点它才弹出来显示这些信息，再点一下或点别处就收起。同时**页签标题**从现在的「提交 @ 哈希」改成**直接显示「提交说明 + 短哈希」**（例：`修复登录bug @ a1b2c3d`），不点进去也能一眼认出是哪次提交。不动任何数据、不动 git 操作，只是把信息换个地方放、页签换个写法。

## 目标

把 CommitDetailView 顶部的提交头折叠成叹号弹窗，并让页签直接显示提交说明 + 短哈希。

**可验证的验收标准（浏览器可观察）**：
1. 在提交图（GitGraph）点一次提交 → 编辑区打开的「提交详情」标签**顶部不再有那块提交信息条**，文件清单/diff 区域上移占满。
2. 标签页内能看到一个 ❗（叹号）图标按钮；**点它** → 弹出一个小面板，里面显示提交说明、作者、时间、短哈希、正文（与原提交头内容一致）；**再点一次叹号 / 点面板外 / 按 Esc** → 面板收起。
3. 该「提交详情」**页签的标题**直接显示「提交说明 + 短哈希」，例如 `修复登录bug @ a1b2c3d`；提交说明过长时截断 + 省略号，hover 显示完整。
4. 提交说明为空时，页签回退显示「(无提交说明) @ 短哈希」，弹窗里仍显示 `(无提交说明)`，不报错。

## 非目标

- 不改后端任何接口（getProjectCommit / getProjectDiff 现成够用）。
- 不改文件清单、diff 渲染、空树基准等已有逻辑。
- 不给提交头弹窗加新的数据字段（只是把现有 detail 字段换个容器展示）。
- 不动除「提交详情」外的其它标签类型（普通文件标签 basename 行为不变）。

## 实施步骤

1. **store + GitGraph：把提交说明带上页签**。给 `EditorTab` 加一个可选字段 `commitSubject`；`GitGraph.onCommitClick` 调 `openFile` 时把 `c.subject` 一并传进去（`openFile` 已经 `...t` 透传，无需改 store 逻辑，只加类型字段）。
   - 验证：TypeScript 类型检查过（`pnpm -F @aimon/web build`）。
2. **EditorArea：页签标题改为「提交说明 + 短哈希」**。`isCommit` 分支的 `basename` 从固定「提交」改为 `f.commitSubject || '(无提交说明)'`；`title`（hover 全文）同步带上完整说明。短哈希展示沿用现有 `f.commitSha` 那段，不重复加。
   - 验证：浏览器里点提交，页签显示 `<提交说明> @ <短SHA>`，hover 显示完整说明。
3. **CommitDetailView：顶部提交头折叠为叹号弹窗**。移除 116–140 行的「提交头」整块；在文件清单列头（「N 个文件」那一行）左侧放一个 ❗ 按钮；用组件内 `useState` 控制一个就地弹出的小面板（复用 BranchPopover 的"点外/Esc 关闭"套路，但因按钮和面板同在本组件内，直接 absolute 定位即可，不走 portal/anchor rect）。面板内容 = 原提交头的提交说明/作者/时间/短哈希/正文。
   - 验证：浏览器里顶部无信息条；点 ❗ 弹出、再点/点外/Esc 收起；内容与原提交头一致。
4. **自测**：`pnpm -F @aimon/web build` 通过；按需起 dev server 派 vibespace-browser-tester 跑上面 4 条验收（browser-use 未开则在 handoff 说明）。

## 边界情况

- **提交说明为空**：页签和弹窗都回退到 `(无提交说明)`（detail.subject 可能为空字符串）。
- **正文很长**：弹窗内正文沿用原 `max-h-24 overflow-auto` 滚动，不撑爆。
- **合并提交**：原提交头有「合并提交 · 与第一父提交比较」标记，弹窗里要保留这条。
- **detail 还没加载完**：页签靠 `commitSubject`（开标签时就有，来自 GraphCommit），不依赖异步 detail，所以页签标题立即就对；弹窗内容在 detail 到手前按现有 loading 态处理（detail 为 null 时整个视图本就返回 loading/null）。
- **从非 GitGraph 入口开的 commit 标签**（若存在）没有 `commitSubject` → 页签回退「(无提交说明)」，不报错。

## 风险与注意

- 这是纯展示位置调整，**无 mutation、无数据写入、无 async 副作用**，按操作日志规则属豁免（纯样式/展示，不接 logAction）；弹窗开合是本地 view state，不埋点。
- `EditorTab` 加字段属于"修改跨文件 import 的导出 interface"——按破坏性变更协议，加**可选**字段是向后兼容的，不删不改现有字段，grep 确认无消费方因新字段报错即可。
- 注意页签 `basename` 现在用 `font-mono`，提交说明是中文，等宽字体下中文显示正常但可考虑去掉 mono（实现时按观感定，属内部细节）。

## 多模型 Plan 会审

> 跳过：Codex 会审轮被中断（codex 会话 turn_aborted: interrupted，未产出评审），按 CLAUDE.md「外部工具失败不阻塞 plan 交付」回退 Claude 单独定稿。
> [Claude 自审] 结构已最简：页签提交说明在开标签时从 GraphCommit.subject 直接带上 EditorTab（加可选字段），不依赖异步 commitDetailCache，避免页签先显示「提交」再闪变；弹窗复用 BranchPopover 的点外/Esc 关闭套路但因按钮与面板同组件内、用 absolute 就地定位即可，不引 portal。纯展示改动无 mutation，按操作日志规则豁免。
