import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DEFAULT_BACKEND = "http://127.0.0.1:8787";
const CONFIG_PATH = join(homedir(), ".vibespace", "config.json");

let cached = null;

function read() {
  if (cached !== null) return cached;
  if (!existsSync(CONFIG_PATH)) {
    cached = {};
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    cached = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cached = {};
  }
  return cached;
}

/** Resolution order: flag > env > file > built-in default. */
export function resolveBackend(flagValue) {
  if (typeof flagValue === "string" && flagValue) return flagValue;
  if (process.env.VIBESPACE_BACKEND) return process.env.VIBESPACE_BACKEND;
  const f = read();
  if (typeof f.backend === "string" && f.backend) return f.backend;
  return DEFAULT_BACKEND;
}

/** Returns null when no project default is configured. */
export function resolveProjectId(flagValue) {
  if (typeof flagValue === "string" && flagValue) return flagValue;
  if (process.env.VIBESPACE_PROJECT) return process.env.VIBESPACE_PROJECT;
  const f = read();
  if (typeof f.currentProjectId === "string" && f.currentProjectId) {
    return f.currentProjectId;
  }
  return null;
}

export function writeConfig(patch) {
  const cur = read();
  const next = { ...cur, ...patch };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
  cached = next;
}

export function getConfigPath() {
  return CONFIG_PATH;
}
