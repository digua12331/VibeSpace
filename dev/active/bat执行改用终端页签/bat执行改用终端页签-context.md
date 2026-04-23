# bat执行改用终端页签 · context

## 用户确认的选择

- 每次右键"执行"都**新建** `cmd` 页签（不复用）
- bat 跑完**不自动关**页签（停在 `cmd>`）
- `execBatFile` API + `/fs/exec-bat` 路由**一起删**

## 关键文件（本次改动边界）

只改这 3 个文件，其它不动：

1. **`packages/web/src/components/fileContextMenu.ts`** — 右键菜单条目构造
   - 当前：`execItem` 的 `onSelect` 调 `api.execBatFile(projectId, path)`（L95-110）
   - 改为：创建 cmd 会话 → 激活页签 → 订阅 WS → 发送 `cd /d "dir" && "file.bat"\r`
   - 需要新 import：`useStore` from `'../store'`（已在多处非组件文件里用 `useStore.getState()`，合法）
2. **`packages/web/src/api.ts`** — HTTP client
   - 删：`export function execBatFile(...)`（L388-396）
3. **`packages/server/src/routes/fs-ops.ts`** — 后端路由
   - 删：`// ---------- POST /fs/exec-bat ----------` 整块（L248-285）
   - **修正**：`spawn` 在 `reveal-in-explorer` (L67) 和 `open-vscode` (L221) 路由里还在用，import **保留**（plan 阶段判断失误）
   - 其它 import（`dirname`, `existsSync`, `statSync`, `join`, `resolve`）在同文件的其他路由里仍在用，**保留**

## 辅助引用（只读，不改）

- `packages/web/src/store.ts:344,429` — `setActiveSession` / `addSession` 实现
- `packages/web/src/store.ts:338,166-167` — `setActiveTabKind`（`'session'` 激活终端页签区）
- `packages/web/src/components/editor/EditorArea.tsx:95-98,124-129` — 标准的"切到新会话"三连：`setActiveSession + setActiveTabKind('session')`（其中第一个函数还得传 `projectId` 作 key；也有可能是 `ALL_KEY`，但我们有 projectId，直接用）
- `packages/web/src/ws.ts:96-110` — `subscribe` / `sendInput`；未连接时 `sendInput` 自动进 outbox，稍后回放
- `packages/web/src/components/sidebar/DocsView.tsx:264-297` — "派 Claude" 的先例：`createSession + addSession + setActiveSession`，跟我们要做的模式一致
- `packages/server/src/routes/sessions.ts:195` — 新会话 `cwd: proj.path` 确认（这是我们"用项目相对路径 + cd /d"的前提）
- `packages/server/src/pty-manager.ts:82-90` — `agent: 'cmd'` 在 Windows 下用 `process.env.ComSpec || 'cmd.exe'`，与期望一致

## 决策记录

### 决策 1：前端组 cd + bat 指令，后端不动

**选 A（采纳）**：前端拼 `cd /d "<dir>" && "<file.bat>"\r`，后端 `createSession` 保持现有（cwd=projectRoot）。
**选 B（否）**：给 `createSession` / `POST /api/sessions` 加 `cwd` 覆盖字段。

- **为什么 A**：后端不改动，改动面最小。bat 的语义（`%~dp0` 自我定位、`%cd%` 为 bat 父目录）完全能通过 `cd /d` 复刻。
- **资深工程师看了不会觉得过度设计**：单文件改动、一行命令字符串、没有新抽象、没有新字段。

### 决策 2：会话启动后延迟 120ms 再发送命令

**选 A（采纳）**：`await new Promise(r => setTimeout(r, 120))` 再 `sendInput`。
**选 B（否）**：监听 WS 的 `output` 事件，收到第一条 PTY 数据后再发送。
**选 C（否）**：立即发送，不等。

- **为什么 A**：Windows conpty 已知有"启动早期前几 byte 可能吞掉"的边缘现象，120ms 是经验兜底值。方案 B 要引入新的事件等待机制，超出本次外科式改动范围。方案 C 风险太高。
- **熔断**：如果 tasks 阶段实测 120ms 仍会丢输入，再升级到 B，但 plan 不预先实现 B。

### 决策 3：连 `api.ts` 里的 `execBatFile` 一起删

- 用户同意删。grep 全仓确认只剩 `fileContextMenu.ts` 的一处调用方，改完这里就是 0 引用。属于"本次改动引入的孤儿"，按 CLAUDE.md 规则当下删，不留 `// removed` 注释。

### 决策 4：不起"会话标签"特性

- 新建的 cmd 会话页签沿用 `cmd·<shortTail>` 命名（`SessionView` 已有逻辑）。不做"根据 bat 名自动命名"这种扩展。典型 YAGNI。

### 决策 5：不做复用已有会话

- 用户选"新建"。每次新建一个 cmd 页签，简单无状态。会话本身带有"空闲/运行"状态，但做"找一个空闲 cmd 页签复用"要新的查找逻辑 —— 当下不需要。

### 决策 6：路径转换只做 `/` → `\`

- 前端 `path` 是 repo-relative POSIX（来自 `FileContextOpts.path` 注释）。在 cmd 里**正斜杠可用**于很多场景，但对 `cd /d` 后跟 `"<bat>"` 执行，反斜杠更稳妥。不去 escape 其它字符（`&`、`^`、`%` 等），因为：
  1. 仓库内文件路径里出现这些字符的概率极低
  2. 双引号包裹后 cmd 对 `&`、`^` 字面处理
  3. `%` 在双引号内仍会尝试变量展开，但包含 `%` 的文件名本身就怪异，不在本次处理范围
- 遇到确实出问题的路径，再另起 issue。

## 依赖与约束

- **平台**：仅 Windows。右键"执行"项本身靠 `/\.(bat|cmd)$/i.test(path)` 才显示（`fileContextMenu.ts:64`），Linux/macOS 用户根本看不到这个入口，所以新实现也只需照顾 Windows。
- **agent kind**：用 `'cmd'`（非 `'shell'`），因为：
  1. 语义明确，绝对是 `cmd.exe`（`shell` 在 Windows 上也是 cmd，但在未来可能会被用户改成别的）
  2. `SHELL_AGENTS` 常量里已包含 `'cmd'`（L25），后续若需要"发送路径到 cmd 会话"也兼容
- **WS 生命周期**：`aimonWS.subscribe` 幂等（内部 Set），重复调用无害
- **类型检查**：项目用 TypeScript；`packages/web` 和 `packages/server` 各自有 tsconfig。验收时至少跑一次 `pnpm -r build`（等价于全量 tsc），满足 CLAUDE.md 硬规则"静态类型语言必须过类型检查"
- **无新增依赖**：完全用现有 API 和工具函数，无 `pnpm install` 需要

## 风险与不确定性

- **Windows conpty 启动早期丢输入**：有 120ms 兜底；如果实测仍丢，tasks 阶段升级到"监听首帧 output 再发"。这是已知风险点。
- **中文 / 空格路径**：双引号 + UTF-8 conpty 应该 OK；仓库里 `stable鍓湰/` 目录名本身已经是 GB 编码 mojibake（文件系统层），跟本任务无关，不在验收里强测它的 bat。
- **页签堆积**：用户反复点"执行"会累积 cmd 页签。明确接受。
- **bat 里包含交互式 `pause >nul` 等**：不影响（跟双击 Explorer 的当前行为一致，用户在页签里按键继续即可）。
