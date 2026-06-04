# 右键浏览器打开HTML · Plan

> memory 扫过无相关条目（auto.md 仅一条 hook 冒烟；manual.md 仅模板）。

## 背景与区分

- 已有相邻任务 `HTML预览页签`（`dev/active/HTML预览页签/`）做的是 **应用内 iframe 预览 + 元素点选派单**。
- 本任务要的是另一件事：**在文件列表右键某个 html 文件 → 交给系统默认浏览器（Chrome/Edge/…）打开**，省掉"点开所在文件夹再双击"这两步。两个功能互补，不冲突，代码路径也不同（这里不碰 `FilePreview` / iframe）。

## 目标

在 `FilesView` / `ChangesList` 的文件行右键菜单里，**针对 `.html` / `.htm` 文件**新增一项「🌐 在浏览器打开」，点击后调用后端把该文件以项目内绝对路径交给系统默认应用（Windows: `cmd.exe /c start "" "<abs>"`；macOS: `open`；Linux: `xdg-open`）。非 html 文件看不到该项。

### 可验证的验收标准（浏览器里能观察）

1. **能出现**：找一份项目里已存在的 `.html` 文件（无则临时放一份 `demo.html` 到某项目下），在 Files 侧栏右键它 → 菜单里看到「🌐 在浏览器打开」，位置紧邻「打开所在文件夹」下方；右键一份 `.md` / `.ts` / 目录 → **看不到**该项。
2. **能打开**：点击该菜单项 → 系统默认浏览器被拉起并打开该 html 文件内容（Windows 上新 tab 打开；macOS/Linux 同理）。
3. **安全兜底**：手工 `curl -X POST /api/projects/<id>/fs/open-in-browser` 传 `path: "../../../../../etc/passwd"` → 返回 400 `path_outside_project`；传 `path: "README.md"`（非 html）→ 返回 400 `not_a_html_file`；传不存在的路径 → 返回 404 `path_not_found`。
4. **日志可回放**：操作成功后，LogsView 里能看到前端起止配对 `scope=fs action=open-in-browser`（`msg='在浏览器打开 开始' → '在浏览器打开 成功 (Nms)'`）；后端也有一条 `info scope=fs` 记录成功。人工制造一次失败（传非 html 后缀）→ LogsView 出现 `ERROR` 条目。
5. **类型检查通过**：`pnpm -r build` 成功（或项目既有等价命令），且本次改动涉及文件无 TS 报错。

## 非目标 (Non-Goals)

- **不支持批量选中多 html 一起打开**：右键一次只作用于该行。
- **不新增"选浏览器"对话框**：固定走系统默认（用户如想换浏览器去系统设置改默认应用）。
- **不处理相对资源**：把 html 交给浏览器后，相对的 `<link>`/`<script>`/`<img>` 都以 `file://<abs_dir>/` 为 base 解析，这是 OS+浏览器的标准行为，本任务不做 `<base>` 注入 / 静态代理。
- **不复用 `HTML预览页签` 的 iframe 预览逻辑**：那是应用内场景，本任务是外部启动。代码完全独立。
- **不扩展到 `.pdf` / `.svg` / `.md` 等其他"浏览器友好"格式**：本期只开口子给 `.html` 和 `.htm`（`.xhtml` 作为等价看待；如果你希望更窄或更宽，plan 确认时说一声）。
- **不碰项目列按钮**：本任务不在 `ProjectsColumn.tsx` 加全局按钮，只动文件右键菜单。

## 实施步骤（粗粒度）

1. **后端 · 新增路由 `POST /api/projects/:id/fs/open-in-browser`**（`packages/server/src/routes/fs-ops.ts`）：
   - 复用既有 `PathBody` / `loadProjectOr404` / `safeResolve` / `existsSync` 三件套校验。
   - **后缀白名单**：`/\.(html?|xhtml)$/i`（小写比较），否则 `400 not_a_html_file`。
   - **拉起默认应用**：封一个 `openWithDefaultApp(abs)`，按平台分支：
     - `win32`: `spawn('cmd.exe', ['/c', 'start', '', absPath])`（第二个空串是 `start` 的"窗口标题"占位，避免 start 把绝对路径当 title 吃掉）
     - `darwin`: `spawn('open', [absPath])`
     - 其他: `spawn('xdg-open', [absPath])`
     - 全部 `detached: true, stdio: 'ignore'`，`child.on('error', ...)` 吞一下，`unref()` — 同 `revealInSystemExplorer` 的 fire-and-forget 风格。
   - 成功返回 `{ok:true}`，并 `serverLog('info','fs','open-in-browser 成功', { projectId, meta:{ relPath }})`；校验失败路径也 `serverLog('warn'/'error', ...)`。
   - verify：`curl` 合法路径返 200；非 html 返 400；越界返 400；不存在返 404。

2. **前端 · `api.ts` 加封装**（在 `openInVscode` 下方追加）：
   ```ts
   export function openInBrowser(
     projectId: string,
     path: string,
   ): Promise<{ ok: boolean }>
   ```
   - verify：TS 类型通过；风格与 `openInFolder` 完全对齐。

3. **前端 · `fileContextMenu.ts` 条件插入菜单项**：
   - 在 `const isBatch = ...` 旁加 `const isHtml = kind === 'file' && /\.(html?|xhtml)$/i.test(path)`。
   - 构造 `browserItem: ContextMenuItem | null`，点击时用 `logAction('fs', 'open-in-browser', async () => { await api.openInBrowser(projectId, path) }, { projectId, meta: { path }})` 包住；失败走 `alertDialog`（同 `execItem` / `openInFolder` 风格）。
   - 注入位置：`return` 数组里 "打开所在文件夹" 后、`execItem` / `添加到 .gitignore` 前。**顺序直接写死**，不做配置项。
   - verify：右键 .html 能看到；右键 .md / 目录看不到；点击触发 API；失败弹 alertDialog。

4. **操作日志验证**：
   - 走一次成功 → LogsView 能看到前端两条（起止配对）+ 后端一条 info。
   - 传非 html 制造一次失败（通过 devtools 手工发一个 API 请求或临时把前端白名单放开）→ 看到 ERROR。
   - verify：两条 verify 都在浏览器里操作完成。

5. **类型检查 & 冒烟**：
   - `pnpm -r build` 成功（若 web 包因预存在问题报错，只确认本次改动的 4 个文件无报错）。
   - 实际浏览器里跑完第 1-4 个验收点。

## 边界情况

- **路径含空格或中文**：Windows 的 `start "" "<abs>"` 已经用双引号包，spawn 用数组参数由 node 处理转义，不会出问题。macOS/Linux 的 `open` / `xdg-open` 同样接受 argv 数组，无 shell 注入风险。
- **系统无默认浏览器**（极少见）：`start` 会弹"请选择应用"系统对话框；`xdg-open` 会退出码非 0。后端 fire-and-forget 不感知，前端表现为"看起来没反应"。**本期不处理**（同 `openInFolder` / `openInVscode` 的既有约定）。
- **html 文件在 Windows 被其他程序占用写锁**：不影响读取，浏览器仍能打开。
- **`.htm` 大小写混合**（`.HTML`、`.Htm`）：正则带 `/i` 匹配。
- **目录结尾是 `.html`**（例如某人建了个叫 `site.html` 的目录）：`kind === 'file'` 会把目录排除掉，不触发。
- **大文件**（几十 MB 的单页 html）：浏览器自己扛，后端只 spawn，无内存压力。
- **路径含 `%` / `&` / `^`** 等 cmd 特殊字符：通过 `spawn` 的 argv 数组传递（而非拼接 shell 命令），Windows 的 start 会正确解析；本项目既有 `revealInSystemExplorer` 也是同款用法。

## 风险与注意

- **假设 1：Windows 上 `start "" <path>` 可以让 html 走默认浏览器**。这是 `cmd /c start` 的标准语义，和项目既有 `revealInSystemExplorer` 的 `explorer.exe /select,<abs>` 平级。
- **假设 2：只允许 `.html` / `.htm` / `.xhtml` 三种后缀**。如果你希望也能右键 `.pdf` / `.svg` 走浏览器，告诉我，我在 plan 里扩白名单；否则严格保留以免菜单噪声。
- **假设 3：菜单项统一放在「打开所在文件夹」下方**，而不是最顶上或在"发送到对话"旁。放下方的理由：它和"打开所在文件夹"同属"外部打开"一类；用户如果偏好别的位置，请在 plan 确认时指出。
- **可能溢出本期的模块**：`packages/server/src/routes/fs-ops.ts`、`packages/web/src/api.ts`、`packages/web/src/components/fileContextMenu.ts`。不会碰 `FilesView.tsx` / `ChangesList.tsx`（两者已通过 `buildFileContextItems` 自动继承）、不会碰任何 WS / terminal / docs 路径。
- **日志规则遵守**：按 CLAUDE.md「操作日志规则」，新增的"用户可感知 mutation API" 必须前后端配对日志；这里也把后端 serverLog 加上，不走"只前端埋点"的偷懒路径。

## 待确认（请回复后进 context）

1. **后缀白名单**：是就 `.html / .htm / .xhtml` 三个，还是要顺带加 `.pdf` / `.svg` / `.md` / `.json` 这类也能浏览器看的？
2. **菜单位置**：是否就放「打开所在文件夹」下方（默认方案）？
3. **需要"打开到指定浏览器"吗**？（默认：只走系统默认；要选浏览器就得加配置 UI，按"不做投机性代码"原则我倾向不做）
4. **小改动合并 plan+context**：这个任务改动很小（4 个函数、≤ 80 行），要不要直接把 plan 和 context 合并一轮确认（按 CLAUDE.md 对小改动的约定）？
