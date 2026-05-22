import { parseArgs, assertKnownFlags } from "../args.mjs";
import {
  readFile,
  writeFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `vibespace skill install — install the VibeSpace CLI skill into Claude's global skill dir

Copies packages/cli/skill/vibespace-cli.md (the monorepo source of truth) to
~/.claude/skills/vibespace-cli/SKILL.md so Claude Code can auto-discover it.

Options:
  --force   overwrite even when the target already has different content
  --json    machine-readable output

Exit: 0 ok, 1 fs failure, 3 invalid args or refusal (file exists differently without --force)
`;

const HERE = dirname(fileURLToPath(import.meta.url));
// commands/skill.mjs -> src/commands -> src -> packages/cli -> skill/vibespace-cli.md
const SOURCE_PATH = join(HERE, "..", "..", "skill", "vibespace-cli.md");
const TARGET_PATH = join(homedir(), ".claude", "skills", "vibespace-cli", "SKILL.md");

export async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (sub !== "install") {
    process.stderr.write(`error: invalid_args\nunknown subcommand 'skill ${sub}' (v1 only supports 'install')\n`);
    return 3;
  }
  return install(rest);
}

async function install(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["force", "json"])) return 3;
  if (positional.length > 0) {
    process.stderr.write(`error: invalid_args\nunexpected positional args\n`);
    return 3;
  }

  let source;
  try {
    source = await readFile(SOURCE_PATH, "utf8");
  } catch (err) {
    process.stderr.write(`error: skill_source_missing\n${SOURCE_PATH}: ${err.message}\n`);
    return 1;
  }

  if (existsSync(TARGET_PATH)) {
    try {
      const existing = await readFile(TARGET_PATH, "utf8");
      if (existing === source) {
        if (flags.json) {
          process.stdout.write(JSON.stringify({ ok: true, path: TARGET_PATH, changed: false }) + "\n");
        } else {
          process.stdout.write(`skill already up to date at ${TARGET_PATH}\n`);
        }
        return 0;
      }
      if (!flags.force) {
        process.stderr.write(`error: target_exists_differs\n`);
        process.stderr.write(
          `${TARGET_PATH} exists with different content. Rerun with --force to overwrite (your local edits will be lost).\n`,
        );
        return 3;
      }
    } catch (err) {
      // If we can't read the existing target, fall through and try to overwrite
      // (write itself will surface a clearer error).
      void err;
    }
  }

  try {
    await mkdir(dirname(TARGET_PATH), { recursive: true });
    await writeFile(TARGET_PATH, source, "utf8");
  } catch (err) {
    process.stderr.write(`error: file_write_failed\n${err.message || String(err)}\n`);
    return 1;
  }

  let bytes = source.length;
  try {
    const st = await stat(TARGET_PATH);
    bytes = st.size;
  } catch {
    // best effort — keep buffer length
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, path: TARGET_PATH, bytes, changed: true }) + "\n");
  } else {
    process.stdout.write(`installed skill → ${TARGET_PATH} (${bytes} bytes)\n`);
  }
  return 0;
}
