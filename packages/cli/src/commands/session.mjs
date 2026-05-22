import { parseArgs, assertKnownFlags } from "../args.mjs";
import { apiPost, printError } from "../api.mjs";
import { resolveProjectId } from "../config.mjs";

const HELP = `vibespace session — manage VibeSpace sessions

Subcommands:
  start <agent> [--project <id>] [--task <name>] [--isolation shared|worktree] [--json]

Notes:
  - <agent> commonly one of: claude, codex, gemini, shell, cmd, pwsh.
  - The server validates the agent against its CLI catalog; unknown agents return 400.
  - v1 does not tail PTY output. After 'start' the session id is printed; watch
    the session in the VibeSpace UI (or run 'vibespace logs tail' once it ships).
`;

const KNOWN_ISOLATION = new Set(["shared", "worktree"]);

export async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (sub === "start") return start(rest);
  process.stderr.write(`error: invalid_args\nunknown subcommand 'session ${sub}'\n`);
  return 3;
}

async function start(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["project", "task", "isolation", "backend", "json"])) {
    return 3;
  }
  const agent = positional[0];
  if (!agent) {
    process.stderr.write(`error: invalid_args\nmissing <agent>\nUsage: vibespace session start <agent>\n`);
    return 3;
  }
  if (positional.length > 1) {
    process.stderr.write(`error: invalid_args\nunexpected extra args: ${positional.slice(1).join(" ")}\n`);
    return 3;
  }
  const projectId = resolveProjectId(flags.project);
  if (!projectId) {
    process.stderr.write(
      `error: invalid_args\nno project specified — pass --project <id> or run 'vibespace project switch <id>' first.\n`,
    );
    return 3;
  }
  if (flags.isolation && !KNOWN_ISOLATION.has(flags.isolation)) {
    process.stderr.write(`error: invalid_args\n--isolation must be 'shared' or 'worktree'\n`);
    return 3;
  }
  const body = { projectId, agent };
  if (flags.isolation) body.isolation = flags.isolation;
  if (typeof flags.task === "string" && flags.task) body.task = flags.task;

  const r = await apiPost(flags.backend, "/api/sessions", body);
  if (!r.ok) return printError(r);
  const s = r.json;
  if (flags.json) {
    process.stdout.write(JSON.stringify(s) + "\n");
  } else {
    process.stdout.write(
      `session ${s.id} agent=${s.agent} project=${projectId} status=${s.status}${s.task ? ` task=${s.task}` : ""}\n`,
    );
    process.stdout.write(`  → view in VibeSpace UI; v1 CLI does not tail output.\n`);
  }
  return 0;
}
