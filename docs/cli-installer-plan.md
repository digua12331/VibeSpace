# 启动栏 · CLI 安装器（市售 AI CLI 一键装 · 状态检测 · 安装后自动出现在启动菜单）落地方案

> 面向 aimon 当前项目。
> 目标：在 [StartSessionMenu.tsx](../packages/web/src/components/StartSessionMenu.tsx) 的 **▶ 启动** 旁加一个 **📦 安装 CLI** 入口，点开是一张"市售 AI CLI"目录弹窗。每行一个 CLI（opencode / qoder / kilo / gemini-cli / aider …），右侧显示**实时安装状态**（已装 / 未装 / 正在装 / 失败）和 **一键安装** 按钮。点安装即在后台 spawn `cmd /c <install cmd>`（Windows）或 `sh -c`（*nix），输出实时回流到弹窗内的 mini xterm；装完后自动重新检测并刷新启动菜单——下次点 ▶ 启动 就能看到刚装好的 CLI。

---

## 1. 市售 AI CLI 调研（截至 2026-04）

下面是当前社区常见、可命令行启动的 AI 编码 CLI。**安装命令是默认 npm/pip 路径**，每个 CLI 都给出了 PATH 上的可执行名（用于 `findExecutable` 检测）。

| ID | 名称 | 类型 | 安装命令（推荐） | 检测可执行名 | 备注 |
|---|---|---|---|---|---|
| `claude` | Claude Code | Anthropic 官方 | `npm i -g @anthropic-ai/claude-code` | `claude` | 已内置 |
| `codex` | OpenAI Codex CLI | OpenAI 官方 | `npm i -g @openai/codex` | `codex` | 已内置 |
| `gemini` | Gemini CLI | Google 官方 | `npm i -g @google/gemini-cli` | `gemini` | 免费额度高 |
| `opencode` | OpenCode | 开源 (TUI) | `npm i -g opencode-ai` | `opencode` | 多模型聚合 |
| `qoder` | Qoder CLI | Qoder | `npm i -g @qoder-ai/qodercli` | `qodercli` / `qoder` | TUI |
| `kilo` | Kilo CLI | Kilo Code | `npm i -g @kilocode/cli` | `kilo` | 开源 |
| `aider` | Aider | 开源 (Python) | `pip install -U aider-chat` | `aider` | 需 Python |
| `crush` | Crush | Charmbracelet | `npm i -g @charmland/crush` | `crush` | TUI |
| `goose` | Goose | Block | `curl -fsSL https://github.com/block/goose/releases/latest/download/download_cli.sh | bash` | `goose` | *nix only（Windows 用 winget）|
| `copilot` | GitHub Copilot CLI | GitHub | `gh extension install github/gh-copilot` | `gh` + `copilot` 子命令 | 需先装 `gh` |
| `cursor-agent` | Cursor Agent | Cursor | `curl https://cursor.com/install -fsS | bash` | `cursor-agent` | *nix only |

**目录文件**放在 [packages/server/src/cli-catalog.ts](../packages/server/src/cli-catalog.ts)（新建），见 §3.1。这样以后加新 CLI 只改一个数组、不用动 UI 也不用动 PTY。

---

## 2. 现状对接

- 启动入口已在 [StartSessionMenu.tsx](../packages/web/src/components/StartSessionMenu.tsx)，目前硬编码 5 项（claude / codex / shell / cmd / pwsh）。
- 后端按 `agent` 名 spawn PTY，可执行查找逻辑已在 [pty-manager.ts:55](../packages/server/src/pty-manager.ts#L55) `findExecutable(name)`——**完全可以复用做安装状态检测**。
- 路由模块化：每个 feature 一个 `routes/*.ts`（[index.ts:20-24](../packages/server/src/index.ts#L20-L24)），新增 `cli-installer.ts` 顺路注册即可。
- AgentKind 是 union：[types.ts:1](../packages/web/src/types.ts#L1)。要让"装好的新 CLI"能进启动菜单，得把 agent 列表从**硬编码 union → 后端目录驱动**（见 §4.3）。

---

## 3. 后端方案

### 3.1 CLI 目录（单一事实源）

新建 [packages/server/src/cli-catalog.ts](../packages/server/src/cli-catalog.ts)：

```ts
export type CliPlatform = 'win32' | 'darwin' | 'linux' | 'all'

export interface CliEntry {
  /** 稳定 id；同时作为 agent name 用于 spawn */
  id: string
  label: string
  /** PATH 上要找的可执行文件名（多个候选时取首个存在的） */
  bin: string[]
  /** spawn 时附加的参数（例如 pwsh -NoLogo），可选 */
  spawnArgs?: string[]
  /** 平台 → 安装命令；分别给 Windows/posix */
  install: Partial<Record<CliPlatform, string>>
  /** UI 上的一行说明 */
  description?: string
  /** 是否官方内置（这些条目在 UI 上仍显示，但安装按钮变"重装"） */
  builtin?: boolean
}

export const CLI_CATALOG: CliEntry[] = [
  {
    id: 'claude', label: 'Claude Code', bin: ['claude'],
    install: { all: 'npm i -g @anthropic-ai/claude-code' },
    description: 'Anthropic 官方', builtin: true,
  },
  {
    id: 'codex', label: 'OpenAI Codex', bin: ['codex'],
    install: { all: 'npm i -g @openai/codex' },
    description: 'OpenAI 官方', builtin: true,
  },
  {
    id: 'gemini', label: 'Gemini CLI', bin: ['gemini'],
    install: { all: 'npm i -g @google/gemini-cli' },
    description: 'Google 官方，免费额度高',
  },
  {
    id: 'opencode', label: 'OpenCode', bin: ['opencode'],
    install: { all: 'npm i -g opencode-ai' },
    description: '开源 · 多模型聚合 TUI',
  },
  {
    id: 'qoder', label: 'Qoder CLI', bin: ['qodercli', 'qoder'],
    install: { all: 'npm i -g @qoder-ai/qodercli' },
  },
  {
    id: 'kilo', label: 'Kilo CLI', bin: ['kilo'],
    install: { all: 'npm i -g @kilocode/cli' },
  },
  {
    id: 'aider', label: 'Aider', bin: ['aider'],
    install: { all: 'pip install -U aider-chat' },
    description: '需要本机 Python',
  },
  {
    id: 'crush', label: 'Crush', bin: ['crush'],
    install: { all: 'npm i -g @charmland/crush' },
  },
  // … 后续按 §1 表格扩
]
```

### 3.2 检测路由（同步、纯 PATH 扫描）

新建 [packages/server/src/routes/cli-installer.ts](../packages/server/src/routes/cli-installer.ts)：

```ts
GET  /api/cli-installer/catalog         → CliEntry[] （静态目录）
GET  /api/cli-installer/status          → { [id]: { installed: boolean, path: string|null, version?: string } }
POST /api/cli-installer/install         → { jobId: string }      启动安装任务
GET  /api/cli-installer/jobs/:jobId     → { state, exitCode, log }   轮询状态（也可改 SSE）
DELETE /api/cli-installer/jobs/:jobId   → 取消未完成的任务
```

**status 的实现**直接复用 [pty-manager.ts:55](../packages/server/src/pty-manager.ts#L55) 的 `findExecutable`，对每个 `entry.bin` 取第一个命中：

```ts
import { findExecutable } from '../pty-manager.js'
for (const e of CLI_CATALOG) {
  let hit: string | null = null
  for (const name of e.bin) { hit = findExecutable(name); if (hit) break }
  out[e.id] = { installed: !!hit, path: hit }
}
```

> 可选：对命中的可执行额外跑一次 `<bin> --version`（带 1.5s 超时）拿版本号。装完成后立刻显示版本，体验更踏实。

### 3.3 安装任务（child_process · 内存任务表 · 实时日志）

不要直接把安装命令塞进现有 `ptyManager`——那是按 sessionId 给前端订阅的，会污染 session 视图。开一个独立的 **InstallJobManager**：

```ts
// packages/server/src/install-jobs.ts
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

interface Job {
  id: string
  cliId: string
  cmdline: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  exitCode: number | null
  log: string                  // 截断到 64KB
  startedAt: number
  proc: ReturnType<typeof spawn>
}

class InstallJobManager extends EventEmitter {
  private jobs = new Map<string, Job>()
  start(cliId: string, cmdline: string): Job {
    // Windows → cmd /d /s /c <cmd>；*nix → /bin/sh -lc <cmd>
    const isWin = process.platform === 'win32'
    const proc = isWin
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdline], { windowsHide: true })
      : spawn('/bin/sh', ['-lc', cmdline])
    const job: Job = {
      id: nanoid(12), cliId, cmdline, state: 'running',
      exitCode: null, log: '', startedAt: Date.now(), proc,
    }
    const append = (chunk: Buffer) => {
      job.log += chunk.toString('utf8')
      if (job.log.length > 64_000) job.log = '…(truncated)…\n' + job.log.slice(-32_000)
      this.emit('log', job.id, chunk.toString('utf8'))
    }
    proc.stdout.on('data', append)
    proc.stderr.on('data', append)
    proc.on('exit', (code) => {
      job.state = code === 0 ? 'done' : 'failed'
      job.exitCode = code
      this.emit('exit', job.id, code)
    })
    this.jobs.set(job.id, job)
    return job
  }
  get(id: string) { return this.jobs.get(id) }
  cancel(id: string) {
    const j = this.jobs.get(id); if (!j || j.state !== 'running') return false
    j.proc.kill('SIGTERM'); j.state = 'cancelled'; return true
  }
}
export const installJobs = new InstallJobManager()
```

> **安全**：`cmdline` **不能取自请求体**——只能从服务端 `CLI_CATALOG` 的对应平台字段取。请求体只带 `cliId`。这样 cmdline 是常量，没有命令注入风险。

### 3.4 实时日志推送

两条路任选其一（推荐 A）：

| 选项 | 实现 | 适用 |
|---|---|---|
| **A. SSE** | 新增 `GET /api/cli-installer/jobs/:jobId/stream` 用 `text/event-stream`，监听 `installJobs` 的 `log/exit` 事件 | 轻量、单向，与现有 fastify 不冲突 |
| B. 复用 ws-hub | 让 ws-hub 多一种消息类型 `install_log` | 想统一通道就用，但要扩 client/server 协议 |

SSE 示例：

```ts
app.get('/api/cli-installer/jobs/:id/stream', (req, reply) => {
  const id = (req.params as { id: string }).id
  const j = installJobs.get(id); if (!j) return reply.code(404).send()
  reply.raw.setHeader('content-type', 'text/event-stream')
  reply.raw.setHeader('cache-control', 'no-cache')
  reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ log: j.log, state: j.state })}\n\n`)
  const onLog = (jid: string, chunk: string) => { if (jid === id)
    reply.raw.write(`event: log\ndata: ${JSON.stringify(chunk)}\n\n`) }
  const onExit = (jid: string, code: number | null) => { if (jid === id) {
    reply.raw.write(`event: exit\ndata: ${JSON.stringify({ exitCode: code })}\n\n`)
    cleanup() } }
  installJobs.on('log', onLog); installJobs.on('exit', onExit)
  function cleanup() {
    installJobs.off('log', onLog); installJobs.off('exit', onExit)
    try { reply.raw.end() } catch {}
  }
  req.raw.on('close', cleanup)
})
```

### 3.5 在 [index.ts](../packages/server/src/index.ts) 注册

```ts
import { registerCliInstallerRoutes } from "./routes/cli-installer.js";
…
await registerCliInstallerRoutes(app);
```

---

## 4. 前端方案

### 4.1 弹窗组件 `CliInstallerDialog.tsx`

新建 [packages/web/src/components/CliInstallerDialog.tsx](../packages/web/src/components/CliInstallerDialog.tsx)：

- 受控 `open / onClose`，Portal 渲染在 `document.body`，背景 `bg-black/60` 点击关闭。
- 顶部一行刷新按钮（重跑 `GET /status`）和过滤（全部 / 未装 / 已装）。
- 主体是 CLI 卡片列表，每张卡片：
  - 左：图标 + 名称 + 描述 + 检测到的 path / version。
  - 中：状态徽章（**已装**绿色 / **未装**灰色 / **正在装**蓝色脉冲 / **失败**红色）。
  - 右：按钮——未装时 `📥 安装`，正在装时 `■ 取消` + 进度旋转，已装时 `↻ 重装` + `▶ 启动`（直达 §4.3）。
- 卡片展开后下方有一个 200px 高的 mini xterm（或纯 `<pre>` 滚动框）实时显示安装日志。
  - 用 [xterm.js](../packages/web/package.json) 已经装过的实例，复用 [SessionTile.tsx:40-68](../packages/web/src/components/SessionTile.tsx#L40-L68) 的初始化思路即可（不接 PTY，只 `term.write(chunk)`）。
  - 也可以图省事直接 `<pre className="font-mono whitespace-pre-wrap overflow-auto">`。

```tsx
function CliRow({ entry, status, onInstalled }: Props) {
  const [job, setJob] = useState<{ id: string; log: string; state: string } | null>(null)
  async function install() {
    const { jobId } = await api.startInstall(entry.id)
    setJob({ id: jobId, log: '', state: 'running' })
    const es = new EventSource(`${api.backendBase()}/api/cli-installer/jobs/${jobId}/stream`)
    es.addEventListener('snapshot', (e) => setJob((j) => j && { ...j, ...JSON.parse((e as MessageEvent).data) }))
    es.addEventListener('log',      (e) => setJob((j) => j && { ...j, log: j.log + JSON.parse((e as MessageEvent).data) }))
    es.addEventListener('exit',     (e) => {
      const { exitCode } = JSON.parse((e as MessageEvent).data)
      setJob((j) => j && { ...j, state: exitCode === 0 ? 'done' : 'failed' })
      es.close()
      void onInstalled()  // 触发父组件重拉 status + 刷新启动菜单
    })
  }
  // … 渲染状态徽章 + 按钮 + 日志框
}
```

### 4.2 在启动菜单加入口

改 [StartSessionMenu.tsx](../packages/web/src/components/StartSessionMenu.tsx)：

1. 把外层从单按钮改成"按钮组"：左 `▶ 启动`，右 `📦 安装 CLI`（或在已展开的下拉菜单底部加 `── 管理 CLI ──` + `📦 安装更多…`）。
2. 点击 `📦` 设 `installerOpen = true`，渲染 `<CliInstallerDialog open={installerOpen} onClose={...} onCatalogChanged={refreshAgents} />`。

### 4.3 启动菜单从硬编码 → 目录驱动

当前 [StartSessionMenu.tsx:80-119](../packages/web/src/components/StartSessionMenu.tsx#L80-L119) 写死了 5 个按钮。改成：

```tsx
const [agents, setAgents] = useState<{ id: string; label: string; installed: boolean }[]>([])
useEffect(() => {
  void Promise.all([api.getCliCatalog(), api.getCliStatus()])
    .then(([cat, st]) => setAgents(
      cat.map((e) => ({ id: e.id, label: e.label, installed: !!st[e.id]?.installed })),
    ))
}, [refreshTick])
// 渲染时只列 installed=true 的；shell/cmd/pwsh 仍在底部固定显示
```

`refreshTick` 在 `CliInstallerDialog` 的 `onInstalled` 里 +1，自然驱动菜单刷新。**装完一个新 CLI，关闭弹窗后再点 ▶ 启动 就能看到它**——这是用户的核心需求点。

### 4.4 后端 spawn 兼容新 CLI

[pty-manager.ts:78-118](../packages/server/src/pty-manager.ts#L78-L118) 的 `resolveAgentSpec` 当前是 `switch(agent)` 硬枚举。改为：

```ts
function resolveAgentSpec(agent: string): SpawnSpec {
  // 内置 shell 三件套保持原样
  if (agent === 'cmd' || agent === 'pwsh' || agent === 'shell') { /* 原逻辑 */ }
  // 其余统统查目录：catalog 找 entry → findExecutable(entry.bin[0..N])
  const entry = CLI_CATALOG.find((e) => e.id === agent)
  if (!entry) throw new Error(`unknown agent: ${agent}`)
  for (const name of entry.bin) {
    const p = findExecutable(name)
    if (p) return { file: p, args: entry.spawnArgs ?? [] }
  }
  throw new Error(`agent executable not found on PATH: ${agent} (looked for ${entry.bin.join(', ')})`)
}
```

`Agent` 类型也从严格 union 放宽为 `string`（仍可在 zod schema 里 `z.string().min(1)` + 业务层 catalog 校验），或者直接动态生成 union：`type Agent = (typeof CLI_CATALOG)[number]['id'] | 'shell' | 'cmd' | 'pwsh'`。

### 4.5 前端 API 客户端追加

[packages/web/src/api.ts](../packages/web/src/api.ts) 加：

```ts
export interface CliEntry { id: string; label: string; bin: string[]; install: Record<string,string>; description?: string; builtin?: boolean }
export interface CliStatusItem { installed: boolean; path: string | null; version?: string }
export const getCliCatalog = () => request<CliEntry[]>('/api/cli-installer/catalog')
export const getCliStatus  = () => request<Record<string, CliStatusItem>>('/api/cli-installer/status')
export const startInstall  = (cliId: string) => request<{ jobId: string }>('/api/cli-installer/install', jsonInit('POST', { cliId }))
export const cancelInstall = (jobId: string) => request<void>(`/api/cli-installer/jobs/${jobId}`, { method: 'DELETE' })
```

---

## 5. 边界与陷阱

| 场景 | 处理 |
|---|---|
| Windows 没有 npm / pip | 在 `status` 里附带 `npm`/`pip`/`gh` 等"前置工具"的检测；缺失时 UI 上把对应 CLI 的 `📥 安装` 灰掉，鼠标悬停提示"需要先安装 Node.js / Python / GitHub CLI" |
| 安装命令需要管理员（PATH 写到系统目录） | npm 全局默认装到用户目录不需要管理员；如果检测到 `EACCES`/`权限`，在日志窗口弹"用管理员重试"按钮（Windows 用 `powershell Start-Process -Verb runAs cmd …`）|
| `findExecutable` 缓存 PATH | Node 启动后 `process.env.PATH` 不会因 npm 全局装而自动更新当前进程的 PATH——但 npm 全局 bin 目录通常**已经**在 PATH 里。如果装完检测仍失败，对该 entry 临时 `process.env.PATH += `${sep}${npmGlobalBin}`` 再查一次 |
| 同一 CLI 重复点安装 | `installJobs` 按 `cliId` 去重：已有 `running` job 就直接返回它的 `jobId`；前端按钮变 `■ 取消` |
| 安装产生超长日志（如 pip 拉大量轮子） | §3.3 已截断到 64KB；前端 `<pre>` 用 `max-height + overflow-auto`，自动滚到底（每次 append 后 `el.scrollTop = el.scrollHeight`）|
| 取消任务遗留 zombie | `proc.kill('SIGTERM')` 后 3s 没退就再 `'SIGKILL'`（与 [pty-manager.ts:229-237](../packages/server/src/pty-manager.ts#L229-L237) 同款防御）|
| SSE 在某些代理下被缓冲 | 加 `X-Accel-Buffering: no` header；本地直连 fastify 时无此问题 |
| 用户跨刷新看历史日志 | `installJobs.get(id)` 已保留完整 log 直到下一次启动；如要永久持久化，落到 `data/install-jobs.jsonl`（追加写）|
| 安装命令里的 `curl ... | bash` | 这种命令在 Windows 上跑不了——目录里给 `install.win32` 显式写 `winget install ...` 或干脆**禁用**（UI 灰掉并提示"暂未支持 Windows 自动安装，请手动跟随官网"）|

---

## 6. 推荐落地顺序

| # | 步骤 | 工作量 | 文件 |
|---|---|---|---|
| 1 | 写 `cli-catalog.ts`（先放 6–8 个 CLI 即可） | 30 分钟 | 新建 |
| 2 | `routes/cli-installer.ts`：catalog / status 两个 GET | 30 分钟 | 新建 + [index.ts](../packages/server/src/index.ts) |
| 3 | `install-jobs.ts` + POST install + SSE stream | 1.5 小时 | 新建 |
| 4 | 前端 `api.ts` 加四个函数 | 15 分钟 | [api.ts](../packages/web/src/api.ts) |
| 5 | `CliInstallerDialog.tsx`（无日志版先跑通） | 1.5 小时 | 新建 |
| 6 | 接入 SSE 日志 + 状态徽章 | 1 小时 | 同上 |
| 7 | `StartSessionMenu` 加 `📦 安装 CLI` 按钮 + 目录驱动 agent 列表 | 1 小时 | [StartSessionMenu.tsx](../packages/web/src/components/StartSessionMenu.tsx) |
| 8 | `pty-manager.resolveAgentSpec` 改为 catalog 驱动 | 30 分钟 | [pty-manager.ts](../packages/server/src/pty-manager.ts) |
| 9 | 前置工具检测（npm/pip/gh） + 平台分支命令 | 1 小时 | 全栈 |
| 10 | （可选）安装日志持久化到 jsonl | 30 分钟 | install-jobs.ts |

---

## 7. 验收清单

- [ ] 启动栏点 `📦 安装 CLI` 弹出弹窗，列出 §1 至少 6 个条目；
- [ ] 已装的（如 claude）显示绿色 ✅ + path + version，未装的显示灰色 ⚪；
- [ ] 点未装项目的 `📥 安装`：按钮变蓝色 spinner，下方日志框实时滚动 npm 输出；
- [ ] 安装命令是从服务端 catalog 取的，不接受请求体里的 cmdline（curl `POST /api/cli-installer/install -d '{"cliId":";rm -rf /"}'` 应当 400）；
- [ ] 安装成功 → 该行变绿色 ✅，再点 ▶ 启动 菜单里出现刚装的 CLI，点击能拉起 PTY；
- [ ] 安装失败 → 红色 ❌ + 退出码 + "查看日志"按钮展开完整 stderr；
- [ ] 同一 CLI 连点两次安装 → 只有一个 job 在跑，第二次点击 reuse 同一 jobId；
- [ ] 关闭弹窗再开 → 之前的 job 状态和日志仍在（内存任务表保留）；
- [ ] Windows 没装 Node 时，所有依赖 npm 的条目按钮置灰 + 悬停提示"需要先装 Node.js"。
