# @aimon/cli — VibeSpace CLI

Small Node CLI that drives the VibeSpace backend (defaults to
`http://127.0.0.1:8787`) from any terminal. Built so an AI agent
(Claude / Codex / Gemini) can create projects, start sessions, and
read/write Dev Docs without manual UI clicks.

> **Backend required.** VibeSpace's backend must be running. Start it from
> the repo root with `pnpm dev`. Then run `vibespace ping` to check.

## Install (development)

This package is part of the VibeSpace monorepo and picked up automatically by
the workspace. After `pnpm install` at the repo root, the binary lives at
`packages/cli/bin/vibespace.mjs`. Three ways to invoke it:

```bash
# From the repo root
pnpm exec vibespace ping

# Direct
node packages/cli/bin/vibespace.mjs ping

# Global symlink (so 'vibespace' is in PATH everywhere)
cd packages/cli && pnpm link --global
vibespace ping
```

## Commands at a glance

```
vibespace ping
vibespace project create <name> [--path <dir>]
vibespace project list
vibespace project delete <id> --yes
vibespace project switch <id>
vibespace session start <agent> [--project <id>] [--task <name>] [--isolation shared|worktree]
vibespace docs read <task> --type plan|context|tasks
vibespace docs write <task> --type plan|context|tasks (--content <str> | --file <path> | --stdin)
vibespace docs archive <task> --yes
vibespace skill install [--force]
```

Run `vibespace --help` or `vibespace <command> --help` for details.

## Configuration

| Source                          | Set what                | Notes                                  |
| ------------------------------- | ----------------------- | -------------------------------------- |
| `--backend` flag                | backend URL             | highest priority                       |
| `--project` flag                | project id              | highest priority                       |
| `VIBESPACE_BACKEND` env         | backend URL             | env > config file                      |
| `VIBESPACE_PROJECT` env         | project id              | env > config file                      |
| `~/.vibespace/config.json`      | backend / project       | written by `vibespace project switch`  |
| built-in default                | `http://127.0.0.1:8787` |                                        |

## Output conventions

- Read / list commands default to a human format and accept `--json` for
  structured output (AI callers should always pass `--json`).
- Errors go to stderr in the form:
  ```
  error: <short_code>
  <one-line human message>
  ```
- Exit codes: `0` ok · `1` backend business error · `2` backend unreachable
  · `3` invalid args / refusal.

## Safety rails

- `project delete` and `docs archive` REQUIRE `--yes` to fire. Without it,
  they print a preview and exit with code 3.
- IDs are exact-match only — no fuzzy lookup. Mistyped id → exit 1
  (`project_not_found`).

## Skill

After `vibespace skill install`, Claude Code (and other Claude-Skill aware
clients) will see this CLI as an installed skill at
`~/.claude/skills/vibespace-cli/SKILL.md`. Source of truth lives in
`packages/cli/skill/vibespace-cli.md` — edit there, then re-run install
with `--force` to push.

## Arg parser limitations

This CLI uses a tiny hand-written parser to stay zero-dependency. It supports:

- `--key value` and `--key=value`
- `--flag` (boolean)
- positional args
- `--` to end flag parsing

It does NOT support:

- single-dash short options (`-x`)
- bundled short options (`-xvf`)
- ambiguous values: an arg starting with `--` is always treated as a flag

If you need richer parsing, file an issue — but the goal is to keep it small.
