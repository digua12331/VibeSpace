/**
 * 系统级 hub 项目维护。
 *
 * D1 翻转 (总控台体验对齐 plan)：hub 从"虚拟视图"变成**真项目** `__hub__`，
 * 这样所有按 projectId 工作的 22 个现有路由能原生服务它，hub session 享受
 * 跟普通项目 session 完全一致的体验 (tab bar / 输入框 / SessionView / ...).
 *
 * **启动顺序硬要求 (Codex 第 1 点警告)**：必须在 db.ts 的 `getDb()` /
 * `syncProjectsTable` 之前调 `ensureHubProject()`，否则 DB 同步发现 __hub__
 * 不在 projects.json 里会 ON DELETE CASCADE 删 hub sessions。
 *
 * 实现细节：
 *  - 直接读写 projects.json (不走 db.ts 私有 helper)。这是 OK 的因为我们
 *    在 server 启动最早 (任何 getDb 之前) 调一次，那时没人在并发写 JSON。
 *  - 用户手动删 __hub__ 条目重启 → 我们再加回来（idempotent）。
 *  - hub 项目 path = `data/hub-workspace/` (跟 hub-workspace.ts 同源)。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHubWorkspace, getHubWorkspaceDir } from "./hub-workspace.js";
import { serverLog } from "./log-bus.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, "..");
const PROJECTS_JSON_PATH = resolve(SERVER_ROOT, "data", "projects.json");

export const HUB_PROJECT_ID = "__hub__";
export const HUB_PROJECT_NAME = "📊 总控台";

interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  // Allow unknown extra keys (layout / workflowMode set by other code).
  [k: string]: unknown;
}

export function ensureHubProject(): void {
  // hub-workspace 目录必须先存在，因为 __hub__ 项目的 path 指向它。
  ensureHubWorkspace();

  const desiredPath = getHubWorkspaceDir();
  let list: ProjectEntry[] = [];
  if (existsSync(PROJECTS_JSON_PATH)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(PROJECTS_JSON_PATH, "utf8"));
      if (Array.isArray(parsed)) list = parsed as ProjectEntry[];
    } catch (err) {
      serverLog("error", "hub", `ensureHubProject 读 projects.json 失败 (将重写)`, {
        meta: { error: (err as Error).message },
      });
      list = [];
    }
  }

  const existing = list.find((p) => p && p.id === HUB_PROJECT_ID);
  if (existing && existing.path === desiredPath && existing.name === HUB_PROJECT_NAME) {
    return; // 已经存在且正确，不写
  }

  if (existing) {
    // path / name 漂移了（升级 / 用户手改），就地修正
    existing.path = desiredPath;
    existing.name = HUB_PROJECT_NAME;
    serverLog("info", "hub", "ensureHubProject 修正 __hub__ 条目", {
      meta: { path: desiredPath },
    });
  } else {
    // 不存在 → 插到列表最前（visual order）
    list.unshift({
      id: HUB_PROJECT_ID,
      name: HUB_PROJECT_NAME,
      path: desiredPath,
      createdAt: Date.now(),
    });
    serverLog("info", "hub", "ensureHubProject 插入新 __hub__ 条目", {
      meta: { path: desiredPath },
    });
  }

  try {
    writeFileSync(PROJECTS_JSON_PATH, JSON.stringify(list, null, 2), "utf8");
  } catch (err) {
    serverLog(
      "error",
      "hub",
      `ensureHubProject 写 projects.json 失败 (启动可能仍能跑但 hub 不可用)`,
      { meta: { error: (err as Error).message } },
    );
  }
}
