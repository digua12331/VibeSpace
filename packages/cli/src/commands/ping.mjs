import { parseArgs, assertKnownFlags } from "../args.mjs";
import { apiGet, HEALTH_TIMEOUT_MS, printError } from "../api.mjs";
import { resolveBackend } from "../config.mjs";

const HELP = `vibespace ping — check VibeSpace backend reachability

Options:
  --backend <url>   override backend (default http://127.0.0.1:8787)
  --json            machine-readable output

Exit: 0 ok, 2 unreachable, 3 invalid args
`;

export async function run(argv) {
  const { positional, flags } = parseArgs(argv);
  if (flags.help || flags.h) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!assertKnownFlags(flags, ["backend", "json"])) return 3;
  if (positional.length > 0) {
    process.stderr.write(
      `error: invalid_args\nunexpected positional args: ${positional.join(" ")}\n`,
    );
    return 3;
  }

  const backend = resolveBackend(flags.backend);
  const r = await apiGet(flags.backend, "/api/health", HEALTH_TIMEOUT_MS);
  if (!r.ok) {
    if (r.error === "backend_unreachable") {
      process.stderr.write(`error: backend_unreachable\n`);
      process.stderr.write(
        `无法连接 ${backend}。请先启动 VibeSpace 后端（在仓库根跑 \`pnpm dev\`）。\n`,
      );
      return 2;
    }
    return printError(r);
  }
  if (flags.json) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        backend,
        version: r.json && r.json.version,
        uptime: r.json && r.json.uptime,
      }) + "\n",
    );
  } else {
    process.stdout.write(
      `ok backend=${backend} version=${r.json && r.json.version}\n`,
    );
  }
  return 0;
}
