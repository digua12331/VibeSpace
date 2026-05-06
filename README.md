# VibeSpace

**English** · [简体中文](./README.zh-CN.md)

A local, browser-based **hub for parallel AI coding agents**. Run multiple
`claude` / `codex` / `gemini` / `opencode` / `qoder` / `kilo` sessions (plus
plain `pwsh` / `cmd` / shell terminals) side-by-side; each session is a PTY
child process hosted by the server and streamed to the browser over
WebSocket. The panel tells you — at a glance, across all projects — which
agent is working, which is idle, and which one is blocked waiting for your
input, and fires a browser notification the moment one needs attention.

## What's different from an editor-embedded agent

Most AI coding surfaces today (VS Code extensions, Cursor, Windsurf, Claude
Code's own in-terminal UI) bind the agent to a single editor window. VibeSpace
comes at the problem from the opposite direction:

| | Editor-embedded agent | VibeSpace |
|---|---|---|
| **Parallelism** | 1 agent per editor tab, no cross-window view | N sessions in one browser panel, any mix of agents |
| **Lifecycle awareness** | "terminal is open somewhere" | explicit states: `starting / running / working / waiting_input / idle / stopped / crashed`, per session |
| **Attention routing** | you go look | browser notification + taskbar badge + title flash on `waiting_input`, only when the tab isn't focused |
| **Survives editor close** | no — kill the editor, kill the agent | yes — PTY pool lives in the server; close browser, reopen, pick up where you left |
| **Git view** | editor's built-in | built-in SCM panel: staged/unstaged/untracked + diff + commit graph, per project |
| **Data locality** | varies | 127.0.0.1 only, SQLite file DB; prompts & output never leave your machine |
| **Workflow opinion** | none | optional **Dev Docs** three-stage workflow (plan → context → tasks) the AI is asked to follow; inspectable in a sidebar |

In one sentence: it's less of an editor and more of a **control tower** —
you spawn agents, keep an eye on their vitals, intervene when prompted, and
navigate their plan documents.

## Highlights

- **Unified workspace tab bar.** File previews and AI terminals share one
  VS Code-style tab strip in the right pane. Pick a changed file from the
  SCM view → new file tab; click `+ 启动 AI / 终端` → new session tab.
- **Multi-agent session launcher.** One dropdown with installed AI CLIs
  plus shell fallbacks. A CLI installer dialog (📦) helps you install the
  missing ones without leaving the panel.
- **Real-time status badges.** Claude uses the official Claude Code hooks
  the server installs into `~/.claude/settings.json`; Codex has no hooks
  so its status is inferred from stdout patterns.
- **Per-project Git SCM panel.** Staged / unstaged / untracked lists with
  stage / unstage / discard / commit controls, diff viewer, and a small
  git-graph of recent commits — all via `simple-git`, no external binary
  other than `git` itself.
- **Dev Docs workflow (opt-in).** Per project, `dev/active/<task>/` holds
  three markdowns (`plan.md`, `context.md`, `tasks.md`). A sidebar 📘 lists
  active tasks with `N/M` checkbox progress pulled from `tasks.md`. A ⚙
  button writes the workflow rules into the project's `CLAUDE.md` so the
  next Claude session enforces *plan → confirm → context → confirm → tasks
  → execute* instead of YOLO coding.
- **Karpathy guidelines installer.** Same mechanism, different content:
  the new-project dialog can seed a `CLAUDE.md` with the widely-used
  Karpathy behavioral guidelines.
- **Per-project performance panel.** 📊 sidebar shows CPU and RSS of each
  live session, polled every 2 s with a 1 s server-side cache. Lets you
  spot the agent eating your RAM before it OOMs the machine.
- **Permissions & custom buttons drawer.** Per-project Claude permission
  tristate matrix and per-project Codex config, plus user-defined xterm
  side-buttons (shortcuts that paste a command into the terminal).
- **All-in-page dialogs.** No native `alert` / `confirm` popups — every
  confirmation is an in-page modal with consistent ESC/Enter behaviour.
- **Skill catalog (🧩).** Browser panel for managing the *Anthropic-standard*
  skills folder layout — `.claude/skills/`, `.codex/skills/`,
  `.opencode/skill[s]/` — that the underlying AI CLIs read directly. Per
  agent: scan project + global, install global skills into the project
  (copy or symlink with EPERM auto-fallback), uninstall, add from any
  custom path. Note: this is **separate** from `.aimon/skills/<name>.md`
  (single-file, trigger-keyed prompt fragments injected by VibeSpace's
  SessionStart hook); the catalog manages the CLIs' own skill system.
- **Skill market (🛒, inside 🧩).** Same panel, second mode: search GitHub
  `topic:skill` and skills.sh in one query, one-click `git clone --depth 1`
  to a local library at `~/SkillManager/` (path configurable; stored in
  `~/.vibespace/skill-market.json`), then reuse the catalog's "install to
  project" button. Hardened: repoUrl whitelist regex, 60s in-process cache
  for GitHub, single-concurrent download with 60s timeout, 50 MB / 5000-file
  size cap, `cpSync` `dereference: true` against symlink-escape, temp dir
  finally-cleanup. Network only fires when you click search or download —
  the panel never phones home on its own.

## Architecture

```
   Browser (Vite + React + zustand + xterm.js)
   ├── ActivityBar  (📂 SCM · 📘 Docs · 📊 Perf · 📋 Logs · 🔔 Inbox)
   ├── Workspace tabs (file previews + live AI / shell sessions)
   └── DialogHost   (confirm / alert / prompt, no native popups)
        |   ^
   HTTP |   | WebSocket  (output | status | exit | replay)
        v   |
   Fastify server (Node 22)
   ├── HTTP routes
   │   ├── projects           — + Karpathy / Dev Docs guideline appenders
   │   ├── sessions           — spawn / restart / kill / hooks inbox
   │   ├── git                — changes / diff / graph / commit
   │   ├── docs               — list / read / create / archive tasks
   │   ├── perf               — per-project CPU / RSS snapshot
   │   ├── cli-configs        — Claude / Codex settings per project
   │   ├── cli-installer      — discovers and installs missing AI CLIs
   │   ├── hooks              — receiver for aimon-hook.mjs
   │   ├── comments           — file comments CRUD
   │   ├── issues             — dev/issues.md reader
   │   ├── memory             — dev/memory/auto.md + manual.md reader
   │   ├── usage              — Claude usage statistics
   │   ├── skill-catalog      — scan / install / uninstall .claude|.codex|.opencode/skills/
   │   ├── skill-market       — GitHub + skills.sh search / git-clone download / local library
   │   └── health
   ├── WS hub                 — subscribe / input / resize / replay
   ├── PtyManager             — node-pty-prebuilt-multiarch
   ├── StatusManager          — lifecycle + Claude hooks
   ├── CodexStatusDetector    — heuristic stdout watcher
   ├── DocsService            — dev/active tree + tasks.md checkbox parse
   ├── PerfService            — pidusage, lazy + cached
   ├── CommentsService        — file comments management
   ├── IssuesService          — dev/issues.md reader
   ├── MemoryService          — dev/memory management
   ├── UsageService           — Claude usage tracking
   ├── SkillCatalogService    — folder-based skills for Claude / Codex / OpenCode
   ├── SkillMarketService     — search/download/library + safety: regex whitelist, size cap, dereference cp
   └── SQLite                 — better-sqlite3, projects/sessions/events
        |
        | spawn / stdin / stdout
        v
   claude.exe  |  codex.exe  |  gemini  |  opencode  |  pwsh  |  …
```

## Requirements

- Node.js >= 22
- pnpm >= 10.20
- Windows 10+ (primary target). macOS / Linux are *experimental* — the PTY
  layer should work but the Windows-specific exit-code mapping and the
  AttachConsole noise are not portable.

External CLIs you bring yourself. Any of them on `PATH` enables the
corresponding agent option:

- `claude` (Claude Code CLI) — first-class, uses official hooks for status
- `codex` — first-class (heuristic status detector)
- `gemini`, `opencode`, `qoder`, `kilo` — launched as plain PTYs, status
  falls back to generic running/idle

The CLI installer dialog (📦) can run platform-appropriate install commands
for most of them if you haven't installed them yet.

## Quick start

```sh
pnpm install
# pnpm 10 disables install scripts by default; run prebuilt binaries once:
pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
pnpm dev:all
# then open http://127.0.0.1:8788
```

`pnpm dev:all` runs both packages in parallel via `pnpm -r --parallel run dev`.
For just one side:

```sh
pnpm dev:server   # Fastify on 127.0.0.1:8787
pnpm dev:web      # Vite on 127.0.0.1:8788
```

## First-time use

1. **Start the backend.** On boot it writes Claude hooks into
   `~/.claude/settings.json` (a backup of the original is dropped next to
   it as `settings.json.aimon-backup` on first run; subsequent runs are
   idempotent).
2. **Add a project.** Click `+ 新建项目`. The path must be an existing
   absolute directory. Two optional checkboxes in the dialog:
   - *追加 Karpathy 通用编码准则* — seeds `CLAUDE.md` with general
     LLM-behavioral guidelines.
   - *启用 Dev Docs 三段式工作流* — appends the plan→context→tasks rules
     so new AI sessions follow the workflow and surface tasks in the 📘
     sidebar. Can be applied later from the 📘 sidebar's ⚙ button.
3. **Start a session.** Click `+ 启动 AI / 终端` in the tab-bar right side,
   pick an installed agent or shell. A new tab appears with a live xterm.
4. **Grant notifications.** Click the footer 🔔 once. `waiting_input`
   nudges only fire when the tab does not have focus.

## Concepts

- **Project.** A directory + a friendly name stored in SQLite. Everything
  else (sessions, docs tasks, perf samples, git changes, CLI configs) is
  keyed by project.
- **Session.** One PTY child process running one agent or shell, tied to a
  project's cwd. A session has a stable id and a live state machine.
- **Workspace tabs.** The right pane. File tabs (markdown preview / source
  / unified diff) and session tabs (xterm with status badge) share the
  same strip.
- **Dev Docs task.** A subdirectory under `<project>/dev/active/<name>/`
  with three markdowns. Created by the AI as the first step of a new
  feature request, not by the human; the human only reviews & archives.
- **Perf sample.** `{ cpu, memRss, pid }` per live session pid, batched
  via `pidusage`, cached 1 s. Direct PTY child only — AI-spawned
  grandchildren are not summed yet.
- **Isolated session (worktree mode).** Optional checkbox in the launch
  menu. When enabled, the server creates a fresh `git worktree add` at
  `packages/server/data/worktrees/<projectId>/<sessionId>/` on a new
  branch `agent/<sessionId8>` and uses it as the PTY's cwd. Multiple
  isolated sessions can edit the same file in parallel without polluting
  the project's main working tree. Closing an isolated session asks
  whether to GC the worktree directory (default: keep). Limitations:
  worktree starts with no `node_modules` (gitignored) — use shared mode
  for `pnpm dev` style workflows. Restart is not supported on isolated
  sessions; close and start a fresh one. Available only when the project
  root is a git repository.
- **Task↔session binding.** Each session can be bound to one Dev Docs
  task name. Right-click a task row in the 📝 Dev Docs sidebar to bind
  it to any alive session in the same project; the task row gets a
  `🔗 agent·id` badge and the session tab gets a `📝 <task>` prefix.
  Closing a session whose task still has unchecked steps surfaces the
  progress in the confirm dialog so it isn't a silent abandon. Binding
  is one-to-one per task; binding to an already-bound task triggers a
  preempt confirm.
- **Background Jobs panel (🛠).** Sidebar tab listing long-running
  server-side tasks: archive review (Dev Docs → 记忆 evaluation by
  codex/gemini) and CLI installer jobs. Polled every 3 s. Running jobs
  can be cancelled; finished review jobs auto-prune after 30 min and
  vanish on server restart. install jobs still have their own dedicated
  detail dialog under 📦.
- **Subagent run cards.** When a Claude session calls the `Task` tool
  to spawn an internal subagent, the parent session's tab shows a
  `🤖×N` badge (N = currently running) and SessionView surfaces a
  violet chip bar above the terminal listing each subagent run with
  type / description / state / duration. Click a chip for a full
  prompt + status dialog. Polled every 5 s while the tab is active;
  in-memory only, server restart clears.
- **Skills · on-demand prompt injection.** Drop markdown skill files
  under `<project>/.aimon/skills/<name>.md`, each with yaml frontmatter
  `triggers: [keyword1, keyword2]` and a body. When you start a session
  bound to a task name, any skill whose triggers match (case-insensitive
  substring of the task name) gets joined into a runtime prompt at
  `<project>/.aimon/runtime/<sessionId>-prompt.md` and exposed via env
  `AIMON_SESSION_PROMPT_PATH`. Whether the agent reads that path is up
  to user-side configuration (e.g. add a one-liner to project CLAUDE.md
  asking the agent to consume it). Add `.aimon/runtime/` to `.gitignore`;
  `.aimon/skills/` should normally be checked in.
- **Comments system.** Inline comments on project files. Each comment is
  anchored to a specific block in the file with a content hash for
  stability. Comments can be created, updated, and deleted via the API.
  Useful for code review and collaboration.
- **Issues tracking.** Reads issues from `<project>/dev/issues.md` and
  displays them in the sidebar. Issues can be tracked and managed as part
  of the development workflow.
- **Memory system.** Reads and manages memory from `<project>/dev/memory/auto.md`
  and `manual.md`. Memory items can be rolled back if needed. This system
  helps maintain context across sessions and tasks.
- **Usage statistics.** Tracks Claude CLI usage statistics, including
  files scanned, entries scanned, and skipped items. Helps monitor
  resource consumption and optimize workflows.

## HTTP API

| Method | Path | Notes |
| -----: | ---- | ----- |
| GET  | `/api/health` | `{ ok, version, uptime }` |
| GET  | `/api/projects` | list |
| POST | `/api/projects` | `{ name, path, applyKarpathyGuidelines?, applyDevDocsGuidelines? }` |
| DELETE | `/api/projects/:id` | also kills any live sessions |
| POST | `/api/projects/:id/apply-dev-docs` | append Dev Docs workflow rules to `CLAUDE.md` |
| GET  | `/api/projects/:id/layout` | stored tile layout (legacy) |
| PUT  | `/api/projects/:id/layout` | persist tile layout |
| GET  | `/api/sessions[?projectId=…]` | list, decorated with live status |
| POST | `/api/sessions` | `{ projectId, agent }` |
| DELETE | `/api/sessions/:id` | **no body or content-type header** (Fastify rejects with 400 otherwise). 204 on success |
| POST | `/api/sessions/:id/restart` | kill + respawn; returns a fresh id |
| POST | `/api/hooks/claude` | receiver for `aimon-hook.mjs`; always `{ ok: true }` |
| GET  | `/api/projects/:id/changes` | git status snapshot |
| GET  | `/api/projects/:id/commits[?limit&branch]` | recent commits |
| GET  | `/api/projects/:id/commits/:sha` | one commit + its files |
| GET  | `/api/projects/:id/file?path=&ref=` | file content at `HEAD` / `WORKTREE` / `INDEX` / sha |
| GET  | `/api/projects/:id/diff?path=&from=&to=` | unified diff |
| GET  | `/api/projects/:id/branches` | local + remote + tags |
| GET  | `/api/projects/:id/graph[?limit&all]` | commits with parent edges |
| POST | `/api/projects/:id/stage` | `{ paths: string[] }` |
| POST | `/api/projects/:id/unstage` | `{ paths: string[] }` |
| POST | `/api/projects/:id/discard` | `{ tracked?, untracked? }` |
| POST | `/api/projects/:id/commit` | `{ message, amend?, allowEmpty? }` |
| GET  | `/api/projects/:id/docs` | list tasks under `dev/active/` with checkbox progress |
| GET  | `/api/projects/:id/docs/:task/file?kind=plan\|context\|tasks` | one markdown |
| POST | `/api/projects/:id/docs` | `{ name }` — creates the three template files |
| POST | `/api/projects/:id/docs/:task/archive` | move to `dev/archive/` |
| GET  | `/api/projects/:id/metrics` | `{ sessions: [{sessionId, cpu, memRss}], totalCpu, totalRssBytes }` |
| GET  | `/api/projects/:id/cli-configs` | Claude / Codex config state for this project |
| PUT  | `/api/projects/:id/cli-configs` | save Claude selections + Codex values |
| POST | `/api/projects/:id/cli-configs/init` | scaffold `.claude/` / Codex dir if missing |
| GET  | `/api/cli-configs/catalog` | permission catalog & presets |
| GET  | `/api/cli-installer/catalog` | known AI CLIs + install commands |
| GET  | `/api/cli-installer/status` | which ones are actually on `PATH` |
| POST | `/api/cli-installer/install` | `{ cliId }` — returns a streaming job id |
| GET  | `/api/cli-installer/jobs/:jobId` | job state + log tail |
| GET  | `/api/cli-installer/jobs/:jobId/stream` | SSE stream of install output |
| GET  | `/api/projects/:id/comments?path=` | list comments for a file |
| POST | `/api/projects/:id/comments` | `{ path, anchor, body }` — create comment |
| PATCH | `/api/projects/:id/comments/:cid` | `{ path, body }` — update comment body |
| DELETE | `/api/projects/:id/comments/:cid?path=` | delete comment |
| GET  | `/api/projects/:id/issues` | list issues from `dev/issues.md` |
| GET  | `/api/projects/:id/memory` | read memory from `dev/memory/auto.md` and `manual.md` |
| POST | `/api/projects/:id/memory/rollback` | `{ items: [{kind, line}] }` — rollback memory items |
| GET  | `/api/usage/claude` | Claude usage statistics |

## WebSocket protocol

`ws://127.0.0.1:8787/ws`, JSON-per-message.

Client → server:

```ts
{ type: 'subscribe',   sessionIds: string[] }
{ type: 'unsubscribe', sessionIds: string[] }
{ type: 'input',       sessionId: string, data: string }
{ type: 'resize',      sessionId: string, cols: number, rows: number }
{ type: 'replay',      sessionId: string }
```

Server → client:

```ts
{ type: 'hello',  serverVersion: string }
{ type: 'output', sessionId: string, data: string }
{ type: 'status', sessionId: string, status: SessionStatus, detail?: string }
{ type: 'exit',   sessionId: string, code: number, signal: number | null }
{ type: 'replay', sessionId: string, data: string }
{ type: 'error',  message: string }
```

`SessionStatus ∈ { starting, running, working, waiting_input, idle, stopped, crashed }`.

## Windows known issues

- Killing the server with `taskkill /F` causes node-pty's helper to print
  `AttachConsole failed` to stderr. Harmless — `Ctrl+C` / SIGINT shutdown is
  the supported path and exits cleanly.
- User-initiated stop on Windows yields exit code `-1073741510`
  (`STATUS_CONTROL_C_EXIT`). The server maps user-initiated kills to
  `stopped` regardless of the raw code, so the badge shows *stopped* not
  *crashed*.
- First `codex` invocation may pop a CLI version-upgrade prompt (`1/2/3`).
  Answer it once interactively; later sessions start cleanly.
- pnpm 10 sets `onlyBuiltDependencies` for the native modules we ship;
  after a fresh `pnpm install` run the `pnpm rebuild` line above.
- `pidusage` uses `wmic` on older Windows; Win11 24H2 may have wmic
  removed, in which case `pidusage v3+` falls back to PowerShell. If perf
  cells show `—`, check that one of the two is available.

## Repository layout

```
VibeSpace/
├── package.json                    workspaces, dev:all, smoke:* scripts
├── pnpm-workspace.yaml
├── CLAUDE.md                       Dev Docs workflow rules for AI sessions
├── README.md / README.zh-CN.md
├── LICENSE
├── dev/active/<task>/              Dev Docs artifacts (AI-maintained)
├── packages
│   ├── server                      Fastify + node-pty + SQLite + WS
│   │   └── src
│   │       ├── index.ts            boot + route registration
│   │       ├── db.ts               SQLite schema + CRUD
│   │       ├── pty-manager.ts      spawn / write / resize / kill / ring buffer
│   │       ├── status.ts           session lifecycle state machine
│   │       ├── codex-status.ts     heuristic detector for codex stdout
│   │       ├── ws-hub.ts           WS protocol handlers
│   │       ├── git-service.ts      changes / diff / commit / graph
│   │       ├── docs-service.ts     dev/active tree + checkbox parse
│   │       ├── perf-service.ts     pidusage, lazy + cached
│   │       ├── hook-installer.ts   writes ~/.claude/settings.json
│   │       ├── karpathy-guidelines.ts   text bundled from andrej-karpathy-skills
│   │       ├── dev-docs-guidelines.ts   Dev Docs workflow rules
│   │       ├── cli-catalog.ts      AI CLI descriptors + detection
│   │       ├── comments-service.ts file comments management
│   │       ├── issues-service.ts   dev/issues.md reader
│   │       ├── memory-service.ts   dev/memory management
│   │       ├── usage-service.ts    Claude usage tracking
│   │       └── routes/
│   │           health · projects · sessions · hooks · git · docs
│   │           · perf · cli-configs · cli-installer · comments · issues
│   │           · memory · usage
│   ├── web                         Vite + React + zustand + xterm.js
│   │   └── src
│   │       ├── App.tsx, main.tsx, store.ts, ws.ts, api.ts, types.ts
│   │       └── components/
│   │           ├── layout/         Workbench · ActivityBar · PrimarySidebar · ProjectsColumn
│   │           ├── sidebar/        ScmView · DocsView · PerfView · LogsView · InboxView
│   │           ├── editor/         EditorArea (unified tab bar)
│   │           ├── terminal/       SessionView (xterm)
│   │           ├── dialog/         DialogHost (in-page modal queue)
│   │           ├── FilePreview · CodeView · DiffView · MarkdownView · GitGraph · ChangesList
│   │           └── StartSessionMenu · CliInstallerDialog · PermissionsDrawer · NewProjectDialog
│   └── hook-script
│       └── aimon-hook.mjs          installed into Claude settings, POSTs /api/hooks/claude
└── scripts                         smoke harnesses
    ├── server-smoke.mjs
    ├── refresh-smoke.mjs
    ├── persistence-check.mjs
    ├── hooks-smoke.mjs
    ├── codex-smoke.mjs
    ├── web-smoke.mjs
    └── git-smoke.mjs
```

## Smoke tests

With the server already running on `127.0.0.1:8787`:

```sh
pnpm smoke:server        # full HTTP+WS create/output/delete cycle
pnpm smoke:refresh       # browser-refresh re-attach to a live session
pnpm smoke:hooks         # POST /api/hooks/claude transitions
pnpm smoke:codex         # codex heuristic detector
pnpm smoke:persistence   # DB row survives a server restart, gets reaped to stopped
pnpm smoke:web           # serves dist + verifies static assets
pnpm smoke:git           # changes / diff / stage / unstage / commit flow
```

## Dual-instance mode (stable + dev)

If you use VibeSpace every day to manage your other projects **and** iterate on
VibeSpace itself, run two copies side-by-side so an in-progress change never
takes down your working control tower.

**Initial setup** (once) — from the dev dir, just run:

```sh
init-stable.bat
```

It refuses to overwrite an existing `f:\KB\AIkanban-stable`, clones this repo
there, checks out the latest `stable-*` tag if one exists (otherwise stays
on the cloned HEAD), runs `pnpm install`, rebuilds native modules
(`better-sqlite3`, `node-pty`), and finally `pnpm build:stable`.

Manual equivalent, if you prefer:

```sh
git clone f:/KB/AIkanban-main f:/KB/AIkanban-stable
cd f:\KB\AIkanban-stable
pnpm install
pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
pnpm build:stable
```

**Run stable** (your daily driver, 8787 / 8788, title `VibeSpace-稳定`):

```sh
cd f:\KB\AIkanban-stable
pnpm start:stable
```

Stable runs **build artifacts** (`node dist/index.js` + `vite preview`), so
file changes in the repo do not trigger a restart. Sessions stay alive until
you restart manually.

**Run dev** (this repo, 9787 / 9788, title `VibeSpace-开发`):

```sh
cd f:\KB\AIkanban-main
pnpm dev:alt
```

Dev runs `tsx watch` + `vite dev` on alternate ports and **skips the global
Claude hook install**, so stable keeps exclusive ownership of
`~/.claude/settings.json`. You can keep both instances open in two browser
tabs.

**Claude status badges still work on the dev side**: the hook script in
`~/.claude/settings.json` points to stable's copy, but it reads
`process.env.AIMON_BACKEND` (injected by the PTY that spawned the child), so
claude sessions launched from the dev UI post hook events back to the dev
server at 9787.

**Sync dev → stable** (from the dev dir, commit first):

```sh
REM in the dev dir, tag the commit you consider release-ready:
git tag stable-2026-04-22
REM then:
sync-to-stable.bat
```

The sync script picks the **latest `stable-*` tag** in dev (by creator date)
and `git reset --hard`es stable to that tag. If no `stable-*` tag exists yet,
it falls back to `origin/main` HEAD so the loop still works from day one.
Tag naming is free-form as long as it starts with `stable-` — dates
(`stable-2026-04-22`), semver (`stable-v1.2.0`), or feature names
(`stable-feat-login`) all work.

The script also: aborts if the dev tree has uncommitted changes; only runs
`pnpm install` + native rebuild if `pnpm-lock.yaml` changed between stable's
current HEAD and the target tag; then `pnpm build:stable`. It **does not
restart stable** — the old process keeps running the old bundle until you
Ctrl+C it and rerun `pnpm start:stable`. Pick that moment when stable is idle.

Tags live in the dev repo's `.git` only (stable's `origin` is the local dev
dir), so you never need to `git push` to a remote — `git fetch origin --tags`
inside stable picks them up.

**Do not edit files inside `f:\KB\AIkanban-stable`.** The next sync will
`git reset --hard` and silently erase local modifications. Use the stable UI
to open `f:\KB\AIkanban-main` as a project and have claude/codex sessions
edit the dev codebase there; test the change by running `pnpm dev:alt` in the
dev dir and opening the second browser tab.

## Roadmap

- LAN-share the panel with a token-based auth header (today: 127.0.0.1 only).
- Interactive `tasks.md` checkbox toggle from the 📘 sidebar (v1 is read-only).
- File-system watcher for `dev/active/` so the Docs sidebar refreshes
  without the manual ⟳.
- Per-session history viewer that tails `session_events` rows from SQLite.
- Recursive process-tree summation for the perf panel (currently direct
  PTY child only).
- Claude session resume (`claude --resume <id>`) on a re-spawn.
- Sparkline / history in the perf panel.
- Mobile-responsive layout.

## Reusing the harness config in other projects

The 6 skill files in `.aimon/skills/` + 7 project-level agent files in
`.claude/agents/` + the two `dev/harness-*.md` blueprints together form a
ready-to-port "agent team + on-demand skill" config. Drop them into any
claude-code-driven project to give it the same `🤖 Task` subagent fleet
and `📝 task → skill injection` flow.

Three install paths:

1. **NewProjectDialog checkbox** — when creating a project from the
   VibeSpace UI, tick "🤝 应用 Harness 团队配置" alongside the existing
   Dev Docs checkbox. Files get copied during project creation
   (best-effort; project still gets created on copy failure).
2. **Project right-click → 🤝 团队** — opens a panel showing per-file
   install status + a single "一键安装缺失" button. Won't overwrite
   anything you've already customised.
3. **Command line** — see
   [`templates/harness/INSTALL.md`](./templates/harness/INSTALL.md) for
   the Bash / PowerShell one-liner. Same logic as the UI paths above.

In all three cases, after install you must read
`<your-project>/.aimon/CUSTOMIZE-harness.md` to rewrite the
VibeSpace-specific bits (≈ 70% of the content references this repo's
fastify / SQLite / Tailwind stack).

## License

MIT — see [LICENSE](./LICENSE).
