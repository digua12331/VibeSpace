# aimon

**English** · [简体中文](./README.zh-CN.md)

Browser-based monitoring panel for AI CLI agents (Claude Code, Codex). Each
project is a directory; each session is a `claude` or `codex` CLI instance
spawned inside a server-hosted PTY and streamed to the browser over
WebSocket. The panel shows live terminal output, real-time status badges,
and fires browser notifications when an agent is waiting on the user.

## Why

Editor-embedded terminals (VS Code, Cursor, etc.) hide their PTYs from any
external monitor — there is no API to read what an agent is currently doing,
whether it is working, idle, or blocked on a confirmation. Tracking many
parallel agents from inside a single editor window is impractical.

aimon wraps the agents in its own PTY pool so the actual interaction is
decoupled from any specific editor: open the panel, see every agent across
every project, and get notified the moment one of them needs attention.

## Architecture

```
   Browser (Vite + React + xterm.js)
        |   ^
   HTTP |   | WebSocket  (output | status | exit | replay)
        v   |
   Fastify server (Node 22)
   ├── HTTP routes  (projects / sessions / hooks / health)
   ├── WS hub       (subscribe / input / resize / replay)
   ├── PTY manager  (node-pty-prebuilt-multiarch)
   ├── StatusManager (lifecycle + Claude hooks)
   ├── CodexStatusDetector (heuristic stdout watcher)
   └── SQLite       (better-sqlite3, projects/sessions/events)
        |
        | spawn / stdin / stdout
        v
   claude.exe   |   codex.exe   (one PTY per session)
```

Claude status transitions are driven by official Claude Code hooks the
server installs into `~/.claude/settings.json`. Codex has no hook surface,
so its status is inferred from stdout patterns (prompt characters, cursor
sequences, idle silence).

## Requirements

- Node.js >= 22
- pnpm >= 10.20
- Windows 10+ (primary target). macOS / Linux are *experimental* — the PTY
  layer should work but the Windows-specific exit-code mapping and AttachConsole
  noise are not portable.

External CLIs you bring yourself:

- `claude` (Claude Code CLI) on PATH
- `codex` (Codex CLI) on PATH — optional; only needed if you want codex sessions

## Quick start

```sh
pnpm install
# pnpm 10 disables install scripts by default; run prebuilt binaries once:
pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
pnpm dev:all
# then open http://127.0.0.1:8788
```

`pnpm dev:all` runs both packages in parallel via `pnpm -r --parallel run dev`
(no extra runner, no sub-processes you have to babysit). For just one side:

```sh
pnpm dev:server   # Fastify on 127.0.0.1:8787
pnpm dev:web      # Vite on 127.0.0.1:8788
```

## First-time use

1. Start the backend. On boot it writes Claude hooks into
   `~/.claude/settings.json` (a backup of the original is dropped next to it
   as `settings.json.aimon-backup` on first run; subsequent runs are
   idempotent).
2. Open the panel and click **+ 项目** to add a monitored directory. The
   path must be an existing absolute directory.
3. Select the project in the sidebar, click **▶ 启动**, and pick **Claude**
   or **Codex**. A new tile appears with a live xterm view.
4. Click the **🔔** button in the header once to grant the browser
   permission for Notifications. waiting_input nudges only fire when the tab
   does not have focus.

## Windows known issues

- Killing the server with `taskkill /F` causes node-pty's helper to print
  `AttachConsole failed` to stderr. Harmless — Ctrl+C / SIGINT shutdown is
  the supported path and exits cleanly.
- When the user stops a session, the PTY exit code on Windows is
  `-1073741510` (`STATUS_CONTROL_C_EXIT`). The server maps user-initiated
  kills to `stopped` regardless of the raw code, so the badge shows
  *stopped* instead of *crashed*.
- The first `codex` invocation may pop a CLI version-upgrade prompt
  (`1/2/3`). Answer it once interactively from any terminal so future
  sessions start without prompting.
- pnpm 10 sets `onlyBuiltDependencies` for the few native modules we ship;
  after a fresh `pnpm install` you must run the `pnpm rebuild` line above
  to actually compile / extract them.

## HTTP API

| Method | Path                            | Notes                                                                |
| -----: | ------------------------------- | -------------------------------------------------------------------- |
|    GET | `/api/health`                   | `{ ok, version, uptime }`                                            |
|    GET | `/api/projects`                 | list                                                                  |
|   POST | `/api/projects`                 | `{ name, path }` — `path` must exist and be a directory              |
| DELETE | `/api/projects/:id`             | also kills any live sessions and cascades the row                    |
|    GET | `/api/sessions[?projectId=…]`   | list, decorated with live status                                     |
|   POST | `/api/sessions`                 | `{ projectId, agent: 'claude' \| 'codex' }`                          |
| DELETE | `/api/sessions/:id`             | **must not include a body or `content-type` header** (Fastify rejects with 400 otherwise). 204 on success. |
|   POST | `/api/sessions/:id/restart`     | kill + respawn under the same id is not done — returns a fresh id    |
|   POST | `/api/hooks/claude`             | called by `aimon-hook.mjs`; always returns `{ ok: true }`            |

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

`SessionStatus` is one of: `starting | running | working | waiting_input | idle | stopped | crashed`.

## Repository layout

```
F:/kanban
├── package.json                  workspaces, dev:all, smoke:* scripts
├── pnpm-workspace.yaml
├── README.md
├── LICENSE
├── packages
│   ├── server                    Fastify + node-pty + SQLite + WS
│   │   ├── src
│   │   │   ├── index.ts          boot, hook install, lifecycle wiring
│   │   │   ├── db.ts             SQLite schema + CRUD
│   │   │   ├── pty-manager.ts    spawn/write/resize/kill + ring buffer
│   │   │   ├── status.ts         derives session state
│   │   │   ├── codex-status.ts   heuristic detector for codex stdout
│   │   │   ├── ws-hub.ts         WS protocol handlers
│   │   │   ├── hook-installer.ts writes ~/.claude/settings.json
│   │   │   └── routes/           health, projects, sessions, hooks
│   │   └── data/aimon.db         created on first boot
│   ├── web                       Vite + React + xterm.js + zustand
│   │   └── src
│   │       ├── App.tsx, main.tsx, store.ts, ws.ts, api.ts, notify.ts
│   │       └── components/       SessionTile, SessionGrid, …
│   └── hook-script
│       └── aimon-hook.mjs        installed into Claude settings, POSTs /api/hooks/claude
└── scripts                       smoke harnesses
    ├── server-smoke.mjs
    ├── refresh-smoke.mjs
    ├── persistence-check.mjs
    ├── hooks-smoke.mjs
    ├── codex-smoke.mjs
    ├── web-smoke.mjs
    └── pty-smoke-test.mjs
```

## Smoke tests

With the server already running on `127.0.0.1:8787`:

```sh
pnpm smoke:server        # full HTTP+WS create/output/delete cycle
pnpm smoke:refresh       # simulates a browser refresh re-attaching to a live session
pnpm smoke:hooks         # POST /api/hooks/claude transitions
pnpm smoke:codex         # codex heuristic detector
pnpm smoke:persistence   # DB row survives a server restart, gets reaped to stopped
pnpm smoke:web           # serves dist + verifies static assets
```

## Roadmap

- LAN-share the panel with a token-based auth header (no auth today; bound to 127.0.0.1).
- Per-session history viewer that tails `session_events` rows from SQLite.
- Claude session resume (`claude --resume <id>`) on a re-spawn.
- Multi-user accounts and per-account project visibility.
- Mobile-responsive layout (current grid assumes >=1024px width).

## License

MIT — see [LICENSE](./LICENSE).
