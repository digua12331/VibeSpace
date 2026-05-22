---
name: vibespace-cli
description: Use when you need to drive VibeSpace (the AI workbench at http://127.0.0.1:8787) from a terminal — creating VibeSpace projects, starting AI sessions (claude / codex / gemini / shell), or reading/writing Dev Docs (plan / context / tasks) for the user. Triggers on phrases like "创建 VibeSpace 项目" / "用 vibespace 起 claude" / "vibespace dev docs" / "在 vibespace 里新建会话".
---

# vibespace CLI

`vibespace` is a small command-line client for the VibeSpace backend. It lets an AI
agent (Claude / Codex / Gemini / etc.) create projects, start sessions, and
read/write Dev Docs without the human having to click through the UI.

## Before you use it: ping check

ALWAYS run `vibespace ping` first. If it returns exit code 2 (`backend_unreachable`),
the VibeSpace backend isn't running — ask the user to run `pnpm dev` in the
VibeSpace repo, then retry. Do NOT try to start the backend yourself unless
explicitly asked.

```
$ vibespace ping
ok backend=http://127.0.0.1:8787 version=1.x.x
```

## Output conventions (important for AI)

- For **read / list** commands, always pass `--json` so the output is structured
  and parsable. The default text output is for humans.
- All errors are written to stderr in the format `error: <short_code>\n<one-line message>`.
- Exit codes: **0** ok · **1** business error (e.g. project_not_found) · **2** backend unreachable · **3** invalid args / refusal.
- Project IDs are 12-char nanoid strings. **No fuzzy matching** — always pass the full id.

## Configuration

Resolution order (highest priority first):

1. Command flags (`--backend`, `--project`)
2. Environment variables (`VIBESPACE_BACKEND`, `VIBESPACE_PROJECT`)
3. `~/.vibespace/config.json` (written by `vibespace project switch <id>`)
4. Built-in defaults (`http://127.0.0.1:8787`)

## Commands

### project

```
vibespace project create <name> [--path <dir>] [--json]
vibespace project list [--json]
vibespace project delete <id> --yes [--json]    # --yes is required
vibespace project switch <id>                   # set default for later commands
```

When the user says "create a VibeSpace project called demo", you do:
```
vibespace project create demo --json
```
Then optionally `vibespace project switch <id>` so later commands can omit `--project`.

### session

```
vibespace session start <agent> [--project <id>] [--task <name>] [--isolation shared|worktree] [--json]
```

`<agent>` is one of `claude` / `codex` / `gemini` / `shell` / `cmd` / `pwsh` (the
server validates). v1 does NOT tail the PTY output — after `start`, the session
exists in the backend; the user can interact via the VibeSpace UI.

### docs (Dev Docs three-file workflow)

```
vibespace docs read <task> --type plan|context|tasks [--project <id>] [--json]
vibespace docs write <task> --type plan|context|tasks (--content <str> | --file <path> | --stdin) [--project <id>]
vibespace docs archive <task> --yes [--project <id>] [--json]    # --yes required
```

Write priority is `--content` > `--file` > `--stdin` — pick exactly one. For
piped content, the natural form is:
```
echo "# my plan" | vibespace docs write my-task --type plan --stdin
```

### skill

```
vibespace skill install [--force]
```

This is the command that installed *this very file* into `~/.claude/skills/vibespace-cli/SKILL.md`.
Run it again after the CLI updates if you want the newest skill.

## What this skill is NOT

- **Not a replacement for the Dev Docs three-file workflow.** The VibeSpace
  CLAUDE.md mandates that non-trivial work goes through plan → context → tasks
  with a pause for human approval after `plan.md`. The CLI `docs write` command
  is for *executing* that workflow (writing files programmatically), not for
  skipping it. Do not use `docs write` to dump tasks.md without first writing
  plan.md and getting human approval.
- **Not a frontend.** The CLI cannot show xterm output or render markdown. If
  the user wants to see results, point them at the VibeSpace UI.
- **Not authenticated.** v1 trusts 127.0.0.1 just like the rest of VibeSpace.
  Remote use is out of scope.

## Safety rails (don't override these)

- `project delete` and `docs archive` REFUSE to run without `--yes`. Don't try
  to bypass — if the user wants to delete, they say "delete", you echo back the
  preview, and only retry with `--yes` after explicit confirmation.
- IDs are exact-match only. If the user mistypes an id, the CLI returns
  `project_not_found` (exit 1) rather than guessing.
