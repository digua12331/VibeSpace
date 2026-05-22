import { parseArgs, assertKnownFlags } from "../args.mjs";
import { apiGet, apiPost, apiDelete, printError } from "../api.mjs";
import { writeConfig } from "../config.mjs";

const HELP = `vibespace project — manage VibeSpace projects

Subcommands:
  create <name> [--path <dir>] [--json]
  list [--json]
  delete <id> [--yes] [--json]
  switch <id>

Notes:
  - <id> must be the FULL project id (nanoid 12-char). No fuzzy matching.
  - 'delete' requires --yes to actually remove; without --yes it just previews.
  - 'switch' writes ~/.vibespace/config.json so later commands can omit --project.
`;

export async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  switch (sub) {
    case "create":
      return create(rest);
    case "list":
      return list(rest);
    case "delete":
      return del(rest);
    case "switch":
      return switchProj(rest);
    default:
      process.stderr.write(
        `error: invalid_args\nunknown subcommand 'project ${sub}'\n`,
      );
      return 3;
  }
}

async function create(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["path", "backend", "json"])) return 3;
  const name = positional[0];
  if (!name) {
    process.stderr.write(`error: invalid_args\nmissing <name>\nUsage: vibespace project create <name> [--path <dir>]\n`);
    return 3;
  }
  if (positional.length > 1) {
    process.stderr.write(`error: invalid_args\nunexpected extra args: ${positional.slice(1).join(" ")}\n`);
    return 3;
  }
  const body = { name };
  if (typeof flags.path === "string" && flags.path) body.path = flags.path;
  const r = await apiPost(flags.backend, "/api/projects", body);
  if (!r.ok) return printError(r);
  const p = r.json;
  if (flags.json) {
    process.stdout.write(JSON.stringify(p) + "\n");
  } else {
    process.stdout.write(`created project ${p.id} '${p.name}' at ${p.path}\n`);
    process.stdout.write(`  → 'vibespace project switch ${p.id}' to use as default\n`);
  }
  return 0;
}

async function list(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["backend", "json"])) return 3;
  if (positional.length > 0) {
    process.stderr.write(`error: invalid_args\nunexpected positional args\n`);
    return 3;
  }
  const r = await apiGet(flags.backend, "/api/projects");
  if (!r.ok) return printError(r);
  const arr = Array.isArray(r.json) ? r.json : [];
  if (flags.json) {
    process.stdout.write(JSON.stringify(arr) + "\n");
  } else {
    if (arr.length === 0) {
      process.stdout.write(`(no projects)\n`);
      return 0;
    }
    for (const p of arr) {
      const id = String(p.id || "").slice(0, 12);
      const name = p.name || "(unnamed)";
      const path = p.path || "";
      process.stdout.write(`${id}  ${name}\n    ${path}\n`);
    }
  }
  return 0;
}

// Server has no GET /api/projects/:id; resolve by listing + matching id.
async function findProjectById(backendArg, id) {
  const r = await apiGet(backendArg, "/api/projects");
  if (!r.ok) return { error: r };
  const arr = Array.isArray(r.json) ? r.json : [];
  const found = arr.find((p) => p && p.id === id);
  return found ? { project: found } : { project: null };
}

async function del(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["yes", "backend", "json"])) return 3;
  const id = positional[0];
  if (!id) {
    process.stderr.write(`error: invalid_args\nmissing <id>\nUsage: vibespace project delete <id> [--yes]\n`);
    return 3;
  }
  if (positional.length > 1) {
    process.stderr.write(`error: invalid_args\nunexpected extra args: ${positional.slice(1).join(" ")}\n`);
    return 3;
  }
  const lookup = await findProjectById(flags.backend, id);
  if (lookup.error) return printError(lookup.error);
  if (!lookup.project) {
    process.stderr.write(`error: project_not_found\nno project with id '${id}'\n`);
    return 1;
  }
  const proj = lookup.project;
  if (!flags.yes) {
    process.stderr.write(`error: confirmation_required\n`);
    process.stderr.write(
      `this would delete project ${proj.id} '${proj.name}' at ${proj.path} — rerun with --yes to confirm.\n`,
    );
    return 3;
  }
  const r = await apiDelete(flags.backend, `/api/projects/${encodeURIComponent(id)}`);
  if (!r.ok) return printError(r);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, deletedId: id }) + "\n");
  } else {
    process.stdout.write(`deleted project ${id} '${proj.name}'\n`);
  }
  return 0;
}

async function switchProj(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["backend"])) return 3;
  const id = positional[0];
  if (!id) {
    process.stderr.write(`error: invalid_args\nmissing <id>\nUsage: vibespace project switch <id>\n`);
    return 3;
  }
  if (positional.length > 1) {
    process.stderr.write(`error: invalid_args\nunexpected extra args: ${positional.slice(1).join(" ")}\n`);
    return 3;
  }
  const lookup = await findProjectById(flags.backend, id);
  if (lookup.error) return printError(lookup.error);
  if (!lookup.project) {
    process.stderr.write(`error: project_not_found\nno project with id '${id}'\n`);
    return 1;
  }
  const proj = lookup.project;
  writeConfig({ currentProjectId: id });
  process.stdout.write(
    `default project switched to ${id} '${proj.name}'. later commands can omit --project.\n`,
  );
  return 0;
}

export { findProjectById };
