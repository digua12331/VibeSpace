import * as ping from "./commands/ping.mjs";
import * as project from "./commands/project.mjs";
import * as session from "./commands/session.mjs";
import * as docs from "./commands/docs.mjs";
import * as skill from "./commands/skill.mjs";

const TOP_LEVEL_HELP = `vibespace — VibeSpace command-line interface

Usage:
  vibespace ping
  vibespace project <create|list|delete|switch> ...
  vibespace session start <agent> [--project <id>] [--task <name>] [--isolation shared|worktree]
  vibespace docs <read|write|archive> ...
  vibespace skill install [--force]

Run 'vibespace <command> --help' for details.

Backend resolution: --backend > env VIBESPACE_BACKEND > ~/.vibespace/config.json > http://127.0.0.1:8787
Project default:   --project > env VIBESPACE_PROJECT > ~/.vibespace/config.json (set by 'vibespace project switch <id>')

Exit codes: 0 ok · 1 business error · 2 backend unreachable · 3 invalid args
Error format: 'error: <short_code>' on stderr followed by a one-line human message.
`;

export async function run(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(TOP_LEVEL_HELP);
    return 0;
  }

  const [verb, ...rest] = argv;
  switch (verb) {
    case "ping":
      return ping.run(rest);
    case "project":
      return project.run(rest);
    case "session":
      return session.run(rest);
    case "docs":
      return docs.run(rest);
    case "skill":
      return skill.run(rest);
    default:
      process.stderr.write(`error: invalid_args\nunknown command "${verb}" — run 'vibespace --help'\n`);
      return 3;
  }
}
