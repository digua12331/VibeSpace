# HTML预览页签 · Context

## 关键文件

> 本次改动的**边界**。列表外的文件原则上不动；真要溢出回来补这份清单。

### 新建

- `packages/web/src/components/HtmlPreview.tsx`
  - 唯一新增 React 组件：`<iframe sandbox="allow-scripts" srcdoc={wrapped}>` + `message` 监听 + 内嵌 picker dialog
  - 参数：`{ projectId: string; path: string; content: string; truncated?: boolean }`
  - 不 fetch：`content` 由父组件 FilePreview 已经拿到的 `file.content` 直接透传，避免重复请求
  - dialog UI 内联在本组件里（单文件；不再拆 `HtmlPickerDialog.tsx`）
- `packages/web/src/components/htmlPreviewPicker.ts`
  - 纯字符串常量 `export const HTML_PREVIEW_PICKER_SCRIPT: string = '...'`
  - 做 hover outline、capture-phase click 拦截、computeSelector、postMessage
  - 选项 A（首选）：Vite `?raw` import 一个 `.js` 文件，代码带类型提示
  - 选项 B（fallback）：如果项目暂时没配 `?raw`（grep 结果 `No matches found`），就在 ts 文件里以模板字符串导出。**采 B 省事**，picker 逻辑本身 ~40 行。
- `packages/web/src/dispatchClaude.ts`（仓库惯例是 src/ 下平铺模块，无 utils/ 目录）
  - 把 `DocsView.tsx:314-347` 的 `dispatchClaude` 逻辑提升为通用函数：
    ```ts
    export async function dispatchClaude(opts: {
      projectId: string
      prompt: string
      successTitle: string
    }): Promise<void>
    ```
  - 内部用 `useStore.getState().addSession / setActiveSession` 直接拿 store（不要求调用者传 setter）
  - 不带 `logAction` 包装——由调用者决定 scope。`DocsView` 现在调用处**没有**包 logAction（只是纯调用），保持不变；`HtmlPreview` 调用处用 `logAction('html-preview', 'dispatch-modification', ...)` 把整段包起来即可。

### 修改

- `packages/web/src/components/FilePreview.tsx`
  - `isMarkdownPath` 旁加 `isHtmlPath`（正则 `/\.(html?|htm)$/i`）
  - `canPreview = canMarkdown || isHtml`
  - `defaultTab` 逻辑：`from/to ? 'diff' : canPreview ? (开头仍走 source) : 'source'`
    - **决定开头默认 source 而不是 preview**：点开 html 不立刻触发 iframe + script。用户主动切 Preview 才渲染。理由写在下面决策记录。
  - `showPreviewTab` 替代原 `canMarkdown` 在 header 里的条件（显示逻辑改成：markdown 或 html 都给 Preview 按钮）
  - body 渲染分支：`tab === 'preview' && canMarkdown` → MarkdownView；`tab === 'preview' && isHtml` → HtmlPreview
- `packages/web/src/components/sidebar/DocsView.tsx`
  - 只改一处：删本地的 `dispatchClaude`（314-347 行整段），改成 `import { dispatchClaude } from '../../utils/dispatchClaude'`
  - 调用点 `dispatchClaude(prompt, successTitle)` → `dispatchClaude({ projectId, prompt, successTitle })`
  - `dispatching` 本地 state 和 `setDispatching` 保留（共享函数不管 UI 禁用态）
  - 其它逻辑一行不动

### 不动的文件（但读过）

- `store.ts` — 不加新字段，HtmlPreview 内部状态全 useState
- `types.ts` — 不扩展 `EditorTab.kind`，不加新 tab kind
- `ws.ts` — 复用 `aimonWS.sendInput(id, data)`，不加新 ClientMsg
- `packages/server/**` — 后端零改动。渲染和派单都在前端完成

## 决策记录

### D1：扩展 FilePreview 的 preview 分支，不新增 tab kind `'html-preview'`

- **选 A（采纳）**：`FilePreview` 内部加 html 判断，preview 分支多一个子组件
- **选 B（不采）**：在 `EditorTab.kind` 加 `'html-preview'`，新增 openHtmlFile action，EditorArea 走新的渲染分支
- **为何**：html 预览本质是"文件的另一种呈现方式"，和 markdown preview 对称。选 B 要改 store / types / EditorArea / openFile 调用点，仅仅为了"让一个文件特殊化"，过度设计。
- **资深工程师视角检查**：会觉得 B 过度设计吗？会。采 A。

### D2：picker 脚本用模板字符串，不引入 `?raw` 导入

- **选 A（采纳）**：在 `htmlPreviewPicker.ts` 里 `export const HTML_PREVIEW_PICKER_SCRIPT = \`...\``，类型安全
- **选 B（不采）**：配 Vite `?raw` 导入 `.js`，能有语法高亮
- **为何**：grep 全仓无 `?raw` 使用先例（"No matches found"），为本期单处需求引入一条新的导入模式不划算。picker 脚本 ~40 行一眼能看完。等未来有第二个地方要注入脚本时再收敛。
- **资深工程师视角检查**：会吐槽字符串难调试吗？可能。但 B 的收益也就"高亮"。采 A。

### D3：dispatchClaude 搬到 utils，签名改成 options 对象

- **选 A（采纳）**：`dispatchClaude({ projectId, prompt, successTitle })` 放 `utils/`
- **选 B（不采）**：两处复制粘贴
- **为何**：两处逻辑完全一致（创建 session + 聚焦 + 剪贴板 + alertDialog 四步），已构成"第二处使用"，重复是明显的浪费。搬家改动只有 ~35 行 delete + 1 行 import，很轻。
- **注意**：不把 `logAction` 包装进去——DocsView 现在没包，HtmlPreview 想包由调用者自己包一层。保持函数职责单一。

### D4：dialog 默认派"新建 Claude 终端"，但给"发到当前活跃终端"选项（方案 C）

- 默认选项 = 新建（安全，沿用现有 派 Claude 行为，用户可 Ctrl+V 校对后再回车）
- 可选 = 发到当前 session（直写 stdin 一步到位，适合 iterate-fast 场景）
- **直发场景的细节**：`sendInput(id, prompt + '\r')`，prompt 内部换行用 `\n`。如果 prompt > 8_000 字符自动降级为"新建 + 剪贴板"，避免 WS 抖动。
- 下拉框只展示**当前项目 + 非 stopped/crashed** 的 session，按 started_at 排序

### D5：iframe sandbox 保持 `allow-scripts`，不加 `allow-same-origin`

- 加 `allow-same-origin` 的话，picker 脚本就能读 parent 的 localStorage / cookie / document；我们的业务需求用不着，移除攻击面。
- srcdoc + allow-scripts 的 postMessage 走的是"不同 origin"路径，仍然可用（parent 接 message 时不要校验 origin，或校验 `null`）。

### D6：html 默认进 Preview（用户反驳后更新）

- 初版：默认 source，避免打开就起 iframe。
- 用户反馈：打开 html 就是为了看渲染，让他多点一次浪费手。
- 最终：html 与 markdown 对称，都默认 `preview`。Source 按钮仍在，想看原文一点就切。

## 依赖与约束

- **`api.createSession({ projectId, agent: 'claude' })`**：已有 API，DocsView 在用。返回 `Session`。
- **`navigator.clipboard.writeText`**：非 HTTPS / iframe 权限拒绝时会 reject。现有代码 catch 后走 fallback alertDialog 展示 prompt 让用户手动复制。沿用。
- **`aimonWS.sendInput(id, data)`**：直写 stdin，已有。无长度限制但我们自觉 8_000 字符降级。
- **`useStore.getState().sessions` + `liveStatus`**：拿活跃 session 列表。过滤条件 `status !== 'stopped' && status !== 'crashed' && projectId === current`。
- **`alertDialog` / `confirmDialog`**：`components/dialog/DialogHost` 已提供。成功/失败提示都走 alertDialog。
- **iframe postMessage origin**：srcdoc iframe 的 origin 是 `null`（opaque）。parent 侧不能 `event.origin === location.origin` 校验；改用 `event.source === iframeRef.current?.contentWindow` + payload 自带 `__aiPicker__: true` 双保险。
- **样式 / Tailwind**：现有项目用 Tailwind + 自定义 fluent-btn；新组件沿用同风格，不引新依赖。
- **操作日志**：`logAction('html-preview', ...)` 会自动经 WS `log-from-client` 落盘到 `packages/server/data/logs/YYYY-MM-DD.log`，LogsView 实时能看到。
- **向后兼容**：DocsView 里 `dispatching` state 的闭包在 `setDispatching(true/false)` 间变更，搬家后行为完全一致（函数成了纯 async，不用管 disabled 态——那是调用者的 UI 问题）。现有"派 Claude 继续任务"等调用点不会退化。

## 遗留 / 不在本次范围的已知坑

- 相对资源（`<img src="./a.png">` 等）在 srcdoc 里解析不出来。v1 不处理，Preview 区顶栏会显式提示"相对资源未处理"。后续若需要：服务器加 `/api/projects/:id/raw?path=...` 原样返回，再在注入时给 html 加 `<base href="...">`。
- picker 不支持"选中的是 shadow DOM 节点"的场景。html 原生 shadow DOM 极少见，v1 忽略。
- 用户选择了元素、还没提交就切走 tab：状态丢弃（组件卸载）。不做持久化。

---

确认 context 后进 tasks 阶段。
