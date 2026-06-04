# 修复自定义CSS不生效 · Context

## 关键文件

- `packages/web/src/theme/store.ts`
  - `applyUserCss(css)` (L60–69)：当前直接 `el.textContent = css`，无任何特异性提升。fix 在此插一道转换。
  - `setCustomCss` (L107–129)：调用 `applyUserCss(css)` 写入；100KB 上限校验已在前面，无需改。
  - 新增模块级纯函数 `bumpRootSpecificity(css)`，导出给测试用（如果之后加）。
- `packages/web/index.html` (L9–25)
  - 同步 IIFE 兜底脚本，从 localStorage 读 `customCss` 直接 `style.textContent = s.customCss`。fix 复刻同一个正则在此就地转换。
- `packages/web/src/theme/themes.css` (L11, L55, L104)
  - 三套预设主题用 `[data-theme="..."] { ... }`，特异性 (0,1,0)。**只读不改**——问题不在这里，是 user CSS 端要追上来。
- `packages/web/src/theme/tokens.css`
  - `:root` 写默认 token（特异性 0,0,1，最低）。这是预设主题用 `[data-theme]` 选择器盖它的设计基线。**只读**。

## 决策记录

### 选择"提升 user CSS 选择器特异性"而非其他方案

候选方案：
- A. **正则升格 `:root` → `:root[data-theme]`**（采用）
  - 利：用户粘贴的 `:root { ... }` 不需要修改就能生效。常见 LLM/网络 CSS 模板都是这种写法。
  - 弊：依赖一个简单正则，不是真 CSS 解析器（但 99% 场景够用，注释/字符串字面量边角不影响功能）。
- B. 让用户自己写 `[data-theme="soft-dark"] { ... }` 选择器
  - 弊：要求用户懂 CSS 特异性 + 知道项目内部约定。大哥不写代码，否决。
- C. 给 user CSS 用 `@layer user-theme` 或 `!important`
  - 弊：layer 需要改 themes.css 把预设包进 lower-priority layer——动到稳定主题系统。`!important` 全文加是污染心智模型，且不能精确控制。
- D. 把 `<style id="user-theme">` 移到 `<body>` 末尾
  - 弊：源代码顺序对**同特异性**才生效，对更高特异性无效——治不了本病。

A 最外科、最聚焦在 `applyUserCss` 一处，其他系统全不动。

### 选择正则边界 `:root` 后不接 `[` / `(`

负向预查 `(?![\[(])`：
- 跳过 `:root[data-theme="x"]`（用户已经手写过特异性）。
- 跳过 `:root(...)`（CSS 没合法语义但保险）。
- **不**跳过 `:root:hover`：这种已经特异性够了，再升格成 `:root[data-theme]:hover` 是冗余但无害；为了正则简单不专门处理。

### 选择 inline 脚本就地复刻而非抽 helper

`index.html` 的 IIFE 在 React 启动**前**同步运行，不能 import 任何 ESM。两处各持一份一行正则（注释互相指向）比绕弯抽 helper 更清晰。这条记到 plan 风险段，提醒后续维护要同步改。

### 不写单元测试

仓库（已扫）没有 web 包的测试基建。本次属于外科式 bug 修复，不为一个小修复新建测试基础设施——交付时用浏览器人工验收 + tsc 类型检查兜底。如果后续主题系统再加复杂逻辑，再起测试基建。

## 依赖与约束

- TypeScript 项目，必须过 `tsc --noEmit`（package.json 里的 typecheck 命令）。
- React + zustand，不动这层。
- 不引新依赖（纯 string.replace + 一段正则）。
- 100KB CSS 上限不变（`MAX_CSS_BYTES`）。
- 操作日志已埋（`logAction('theme', 'apply-css', ...)`），不改。
