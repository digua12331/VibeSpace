# HTML预览页签 · Plan

> memory 扫过无相关条目（auto.md 只有一条 hook 冒烟，manual.md 只有模板）。

## 目标

让 `.html / .htm` 文件在现有的 **file tab** 里多一个 **Preview** 选项卡，点进去能**真实渲染** HTML（沙箱 iframe），并且支持 **点选元素 → 填写修改意图 → 派到 Claude 终端** 的闭环。后续用户改 UI 无需手动复制粘贴元素定位符，指哪打哪。

### 可验证的验收标准（浏览器里能观察）

1. **能渲染**：在项目里找一份 html 文件（无则临时放一份 `demo.html` 到任意项目目录），点开文件 → tab 顶栏出现 `Source / Preview` 切换 → 点 Preview 看到渲染结果（iframe 边框/padding 可见）。
2. **能选元素**：鼠标悬停渲染区域时被 hover 的元素有描边提示；单击某个元素后，弹出"发送修改请求"对话框，预填：
   - 文件相对路径
   - 命中的 CSS selector（链式 nth-of-type）
   - outerHTML 截断到 ≤ 500 字符
3. **能派单**：对话框里输入"把这个按钮背景改成红色" → 选"新建 Claude 终端"或"发到当前选中的终端" → 确认：
   - 新建场景下新 session 出现在 tab 栏并聚焦，prompt 已进剪贴板，提示用户 Ctrl+V + 回车（沿用 DocsView 的 dispatchClaude 风格）
   - 直发场景下对应终端里能直接看到多行 prompt 被写入（走 `aimonWS.sendInput`）
4. **日志可回放**：在 LogsView 能看到起止配对 `scope=html-preview action=pick-element` 与 `scope=html-preview action=dispatch-modification`，失败分支（如取消 clipboard 授权）有 ERROR 一条。
5. **类型检查通过**：`pnpm -C packages/web typecheck`（或项目里等价命令）成功。

## 非目标 (Non-Goals)

- **不做本项目前端实时预览**（React/tsx 组件 → 点击反查组件源码）。那是另一个数量级的事（需要 source-map / vite-plugin-inspector），和静态 html 完全不同路径。
- **不做 HTML 就地编辑**。选中元素之后只生成**发给 Claude 的 prompt**，不在 iframe 里改 DOM。修改最终由 Claude 读源文件改源文件。
- **不自动解析相对资源**（相对路径的 `<img src="./a.png">`、`<link href="./x.css">`）。v1 只保证 html 本身渲染；相对资源的处理放到后续（需要注入 `<base>` 或把资源走 `/api/projects/:id/file` 代理），本期明确留坑。
- **不做多元素批量选择 / 区域框选**。点一次 = 选一个。
- **不启用 iframe 的 allow-same-origin**。保持最严格 sandbox，避免用户 html 读到父页 localStorage。

## 实施步骤（粗粒度，具体排期进 tasks.md）

1. **扩展 FilePreview**：在 `isMarkdownPath` 旁加 `isHtmlPath`；当路径命中时，`canPreview = true` 且 preview 分支渲染新组件 `HtmlPreview` 而不是 `MarkdownView`。默认 tab 保持 `source`（避免用户点开就跑脚本——让用户主动切到 Preview 再渲染）。
   - 验证：用一个简单 `<h1>hi</h1>` 的 html，Source tab 显示原文，Preview tab 显示渲染。

2. **新建 `HtmlPreview.tsx`**：
   - 用 `<iframe sandbox="allow-scripts" srcdoc={wrapped}>` 承载
   - `wrapped = <原 html> + <script>picker.js 内联</script>`（picker 脚本放到文件末尾，附加在 body 结束前；不碰用户 html 本体）
   - 组件内监听 `window.addEventListener('message', ...)`，过滤 `event.source === iframe.contentWindow` 且 `data.__aiPicker__ === true` 的消息
   - 收到消息后 `setPicked(payload)` 触发对话框打开
   - 验证：点任意元素，组件状态变化 → 对话框打开。

3. **写 picker 脚本**（纯字符串，注入到 srcdoc；或者单独做一个 `htmlPreviewPicker.ts` 用 `?raw` 导入到组件里）：
   - hover 时加一个临时 outline（className 加到元素上，离开时移除）
   - 点击时阻止默认行为、阻止冒泡到用户自己的 handler
   - 计算 CSS selector：从该节点向上走到 body，每一级用 `tagName:nth-of-type(n)`，遇到有 id 的就停
   - `postMessage({ __aiPicker__: true, selector, outerHTML: slice(500), tag, id, classList }, '*')`
   - 验证：console 手动触发 `document.body.click()` 能看到 parent 收到消息。

4. **新建 `HtmlPickerDialog.tsx`**（或直接内联到 HtmlPreview 里，视代码行数决定）：
   - 字段：只读的"元素描述"（文件路径 + selector + outerHTML 片段）、可编辑的"修改要求"文本框、一个下拉"发送到"（选项：`新建 Claude 终端` / 当前项目下存活的各个 session）
   - 底部两个按钮：`取消` / `派单`
   - 派单点击 → 构造 prompt → 调用 `dispatchClaude` 的等价逻辑（新建场景）或 `aimonWS.sendInput(sessionId, prompt + '\r')`（直发场景）
   - 验证：走两条分支，分别观察终端/clipboard 行为。

5. **抽出/复用 dispatchClaude**：DocsView 里 `dispatchClaude` 已经实现"新建 session + 聚焦 + 剪贴板 + alertDialog"一整套。把它提升到 `packages/web/src/utils/dispatchClaude.ts`（或 store 的 action）方便此处复用；**动作要小**，不改 DocsView 的调用点语义，只把函数搬家。
   - 验证：DocsView 的派单功能依旧能用（tasks 面板派 claude 继续任务这条路径不退化）。

6. **埋操作日志**（硬性规则）：
   - `logAction('html-preview', 'pick-element', async () => { ... }, { projectId, meta: { selector, tag } })`——包住从"收到 message 到对话框打开"的瞬间
   - `logAction('html-preview', 'dispatch-modification', async () => { ... 派单 })` ——包住派单整段，成功/失败自动起止配对
   - 失败分支人工制造一次（比如把 `writeText` monkey-patch 成 reject）验证 ERROR 出现

7. **类型检查 + 手动冒烟**：
   - `pnpm -C packages/web typecheck`
   - `pnpm dev` 起服务，走一遍验收步骤 1-4

## 边界情况

- **空 html / 纯文本 html**：应仍能渲染（出现空白或纯文字）。picker 仍然可点 body。
- **html 里自带内联 script（带点击监听）**：我们的 picker 必须在 capture 阶段阻止点击冒泡到用户 script；否则用户自己的 handler 会误触发。→ 用 `addEventListener('click', handler, true)` 并 `stopPropagation() + preventDefault()`。
- **html 里带 `<form>` 或 `<a href="...">`**：点击本该导航；由上一条同款 preventDefault 处理。
- **html 超大（MB 级）**：`getProjectFile` 有 `truncated` 字段，截断的 html 渲染出来可能是断的。→ preview 区顶栏加一行"已截断"提示（和现有 FilePreview 截断提示同风格）。
- **二进制/编码问题**：`file.encoding === 'base64'` 直接不让切 Preview（保留现有的"二进制文件不显示内容"兜底）。
- **选择器生成遇到 SVG / MathML 命名空间**：跳过，直接 fallback 用 outerHTML；selector 为 null 时 prompt 里不写 selector 那一行。
- **用户同时开多个 html tab 反复切换**：iframe 的 srcdoc 每次重新加载 picker 脚本，不要做全局单例；状态全部放组件内。
- **sendInput 直发巨大字符串**：WS 层没有长度保护，但 prompt 本身几百字节，不会触顶。外层再封一层 `if (data.length > 8_000) 走剪贴板` 做软兜底。

## 风险与注意

- **假设 1：srcdoc 的 iframe 允许 postMessage 到 parent**。这是浏览器标准行为，不需要 allow-same-origin，放心。
- **假设 2：不用处理相对资源**（见非目标）。如果你其实想看的 html 是带外链 css/js 的业务页，v1 会"白屏 + 无样式"，请在 plan 确认时立即指出，我改方案（最小改动是注入 `<base href="/api/projects/:id/file-raw?path=<dir>/">` 走静态代理）。
- **假设 3：`dispatchClaude` 可以搬家到 utils**。如果搬出去会波及 DocsView 的日志 scope 命名（现在是 `docs`），我会在 context 阶段写明搬完后 DocsView 那边仍然以 `scope=docs` 埋点，派单通用函数里不带 scope，由调用者传。
- **可能溢出本期的模块**：`packages/web/src/components/sidebar/DocsView.tsx`（仅因为搬 dispatchClaude，不动业务逻辑）。不会碰后端 / terminal / ws 层。
- **坑：picker script 注入位置**。如果用户 html 已经有 `</body>` 后面的多余内容，简单的字符串拼接会出错。稳妥做法是不解析 html 直接在末尾追加 `<script>` 标签（浏览器会容忍 body 结束后的 script），或在 DOMContentLoaded 后通过 `document.body.addEventListener(...)` 而非立刻跑。
- **不是坑但值得注意**：新 tab kind 其实不用加。沿用 file tab + 在 FilePreview 内部加 preview 分支，改动最小，与 markdown 预览对称。

---

以上是初稿，等你确认方向、相对资源是否必须支持、以及派单默认是"新建终端"还是"发当前终端"这三点，就进入 context 阶段。
