import { parseArgs, assertKnownFlags } from "../args.mjs";
import { apiGet, apiPost, printError } from "../api.mjs";
import { resolveProjectId } from "../config.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const KIND = new Set(["plan", "context", "tasks"]);

const HELP = `vibespace docs — Dev Docs three-file workflow (plan / context / tasks)

Subcommands:
  read <task> --type <plan|context|tasks> [--project <id>] [--json]
  write <task> --type <plan|context|tasks> (--content <str> | --file <path> | --stdin) [--project <id>]
  archive <task> [--project <id>] [--yes] [--json]

Content sources for 'write' (priority order — pick exactly one):
  --content <inline>   small inline content (best for quick smoke tests)
  --file <path>        read content from local file
  --stdin              read content from stdin (best for pipes: 'echo X | vibespace docs write ... --stdin')

Notes:
  - 'archive' requires --yes to fire; without --yes it previews only.
  - <task> name must not contain \\/:*?"<>| (server-side sanitisation will reject otherwise).
  - 'write' writes the file directly via the project's local path (CLI reads the
    project path from GET /api/projects/:id and then uses fs). The server is the
    source of truth for project location; docs files live on the project's disk.
`;

export async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  switch (sub) {
    case "read":
      return readCmd(rest);
    case "write":
      return writeCmd(rest);
    case "archive":
      return archiveCmd(rest);
    default:
      process.stderr.write(`error: invalid_args\nunknown subcommand 'docs ${sub}'\n`);
      return 3;
  }
}

function requireTaskAndType(positional, flags) {
  const task = positional[0];
  if (!task) {
    process.stderr.write(`error: invalid_args\nmissing <task> name\n`);
    return null;
  }
  const type = flags.type;
  if (!type || !KIND.has(type)) {
    process.stderr.write(`error: invalid_args\n--type must be one of plan|context|tasks\n`);
    return null;
  }
  return { task, type };
}

async function readCmd(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["type", "project", "backend", "json"])) return 3;
  const required = requireTaskAndType(positional, flags);
  if (!required) return 3;
  const projectId = resolveProjectId(flags.project);
  if (!projectId) {
    process.stderr.write(`error: invalid_args\nno project specified — pass --project or 'project switch'.\n`);
    return 3;
  }
  const r = await apiGet(
    flags.backend,
    `/api/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(required.task)}/file?kind=${required.type}`,
  );
  if (!r.ok) return printError(r);
  const body = r.json;
  if (flags.json) {
    process.stdout.write(JSON.stringify(body) + "\n");
  } else {
    process.stdout.write(body && typeof body.content === "string" ? body.content : "");
    if (body && typeof body.content === "string" && !body.content.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  return 0;
}

async function writeCmd(argv) {
  const { positional, flags } = parseArgs(argv);
  if (
    !assertKnownFlags(flags, [
      "type",
      "content",
      "file",
      "stdin",
      "project",
      "backend",
    ])
  ) {
    return 3;
  }
  const required = requireTaskAndType(positional, flags);
  if (!required) return 3;
  const projectId = resolveProjectId(flags.project);
  if (!projectId) {
    process.stderr.write(`error: invalid_args\nno project specified — pass --project or 'project switch'.\n`);
    return 3;
  }

  // Source priority: --content > --file > --stdin. Exactly one must be present.
  let content = null;
  if (typeof flags.content === "string") {
    content = flags.content;
  } else if (typeof flags.file === "string" && flags.file) {
    try {
      content = await readFile(flags.file, "utf8");
    } catch (err) {
      process.stderr.write(`error: file_read_failed\n${err.message || String(err)}\n`);
      return 1;
    }
  } else if (flags.stdin === true) {
    content = await readStdin();
  } else {
    process.stderr.write(
      `error: invalid_args\nmust provide one of --content / --file / --stdin\n`,
    );
    return 3;
  }

  // Server has no GET /api/projects/:id; list + find to resolve the path.
  const listResult = await apiGet(flags.backend, "/api/projects");
  if (!listResult.ok) return printError(listResult);
  const arr = Array.isArray(listResult.json) ? listResult.json : [];
  const proj = arr.find((p) => p && p.id === projectId);
  if (!proj) {
    process.stderr.write(`error: project_not_found\nno project with id '${projectId}'\n`);
    return 1;
  }
  const projPath = proj.path;
  if (!projPath) {
    process.stderr.write(`error: project_missing_path\nproject record has no 'path' field\n`);
    return 1;
  }

  // Ensure the task folder exists by calling POST /docs (idempotent: 409 if
  // already exists — we silently treat that as "fine, just write the file").
  const created = await apiPost(
    flags.backend,
    `/api/projects/${encodeURIComponent(projectId)}/docs`,
    { name: required.task },
  );
  if (!created.ok && created.status !== 409) {
    return printError(created);
  }

  // Local write — dev/active/<task>/<task>-<kind>.md mirrors docs-service.ts.
  const filePath = join(
    projPath,
    "dev",
    "active",
    required.task,
    `${required.task}-${required.type}.md`,
  );
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  } catch (err) {
    process.stderr.write(`error: file_write_failed\n${err.message || String(err)}\n`);
    return 1;
  }
  process.stdout.write(
    `wrote ${required.type} (${content.length} bytes) to ${filePath}\n`,
  );
  return 0;
}

async function archiveCmd(argv) {
  const { positional, flags } = parseArgs(argv);
  if (!assertKnownFlags(flags, ["project", "yes", "backend", "json"])) return 3;
  const task = positional[0];
  if (!task) {
    process.stderr.write(`error: invalid_args\nmissing <task>\n`);
    return 3;
  }
  if (positional.length > 1) {
    process.stderr.write(`error: invalid_args\nunexpected extra args: ${positional.slice(1).join(" ")}\n`);
    return 3;
  }
  const projectId = resolveProjectId(flags.project);
  if (!projectId) {
    process.stderr.write(`error: invalid_args\nno project specified\n`);
    return 3;
  }
  if (!flags.yes) {
    process.stderr.write(`error: confirmation_required\n`);
    process.stderr.write(
      `this would archive task '${task}' in project ${projectId} — rerun with --yes.\n`,
    );
    return 3;
  }
  // Fastify rejects empty body when content-type is application/json, so send
  // an explicit empty object rather than `undefined`.
  const r = await apiPost(
    flags.backend,
    `/api/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(task)}/archive`,
    {},
  );
  if (!r.ok) return printError(r);
  if (flags.json) {
    process.stdout.write(JSON.stringify(r.json) + "\n");
  } else {
    process.stdout.write(
      `archived task '${task}' as '${r.json && r.json.archivedAs}'\n`,
    );
  }
  return 0;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}
