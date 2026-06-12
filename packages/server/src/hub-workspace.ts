/**
 * 总控台 (hub) 隔离工作目录管理。
 *
 *   packages/server/data/hub-workspace/
 *     README.md      ← 给好奇打开此目录的人解释"这里是 hub session 的 sandbox"
 *     .mcp.json      ← hub session 启动时写：注入 MCP server spawn 命令 + token
 *     (hub claude/codex 在这里写任何文件都不会污染真实项目 git 状态)
 *
 * 由 hub-session-runtime 在每次启动 hub session 时调 ensureHubWorkspace +
 * writeHubMcpConfig 重写 .mcp.json（含当前进程的 HUB_TOKEN）。目录本身只
 * 创建一次。
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serverLog } from "./log-bus.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, "..");
const HUB_WORKSPACE_DIR = resolve(SERVER_ROOT, "data", "hub-workspace");

const README_CONTENT = `# Hub Workspace

这是 VibeSpace 总控台 (📊 Hub) 的隔离工作目录。每次启动一个 hub session
(hub 的 claude / codex 终端)，它的 cwd 都指向这里。

**用途**：
- hub 终端 (AI 总指挥) 在这里执行命令、写临时文件，不会污染你的真实项目
  git 状态。
- 本目录下的 \`.mcp.json\` 由 server 在每次启动 hub session 时**自动重写**
  (含一次性 HUB_TOKEN)，请勿手动改。

**安全约束**：
- hub claude 通过 MCP 工具读其它项目，**只能读**，不能修改（白名单见
  hub-session-runtime + mcp-hub）。
- read_file 工具会做路径越界检查 + 大小限制 + 二进制判定。
`;

export function getHubWorkspaceDir(): string {
  return HUB_WORKSPACE_DIR;
}

export function ensureHubWorkspace(): void {
  if (existsSync(HUB_WORKSPACE_DIR)) return;
  mkdirSync(HUB_WORKSPACE_DIR, { recursive: true });
  const readmePath = resolve(HUB_WORKSPACE_DIR, "README.md");
  try {
    writeFileSync(readmePath, README_CONTENT, "utf8");
  } catch (err) {
    // 非致命：README 写不成不影响 hub session 启动。
    serverLog("warn", "hub", `hub workspace README 写入失败 (非致命)`, {
      meta: { error: (err as Error).message },
    });
  }
  serverLog("info", "hub", "hub workspace 已创建", {
    meta: { dir: HUB_WORKSPACE_DIR },
  });
}

// writeHubMcpConfig 已删除——hub-workspace/.mcp.json 现在由 mcp-bridge.ts 的
// injectHubMcps() 写入（含 aimon-hub + browser-use merge + 幂等检查）。

/**
 * 总控台权限全开：往 hub-workspace/.claude/settings.local.json 幂等合并
 * `permissions.defaultMode = "bypassPermissions"`，让 hub claude 不再弹权限
 * 确认（微信/飞书通道里用户无法点确认，会把整条指令卡死）。
 *
 * - 保留文件里已有内容（claude 自己写的 allow 列表等）。
 * - 坏 JSON 先备份成 .bak 再重建最小配置，不阻塞 hub 启动。
 * - 失败只记 error 日志不抛——与 injectHubMcps 同一容错姿态。
 */
export function ensureHubBypassPermissions(): void {
  const claudeDir = resolve(HUB_WORKSPACE_DIR, ".claude");
  const file = resolve(claudeDir, "settings.local.json");
  const fileForLog = file.replace(/\\/g, "/");
  try {
    mkdirSync(claudeDir, { recursive: true });
    let existing: Record<string, unknown> = {};
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, "utf8");
        if (raw.trim()) existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        copyFileSync(file, file + ".bak");
        serverLog("error", "hub", "hub settings.local.json 解析失败，已备份 .bak 后重建", {
          meta: { file: fileForLog },
        });
        existing = {};
      }
    }
    const permissions = (existing.permissions ?? {}) as Record<string, unknown>;
    if (permissions.defaultMode === "bypassPermissions") return; // 幂等：已是全开
    permissions.defaultMode = "bypassPermissions";
    existing.permissions = permissions;
    writeFileSync(file, JSON.stringify(existing, null, 2) + "\n", "utf8");
    serverLog("info", "hub", "hub 权限全开配置已写入 (defaultMode=bypassPermissions)", {
      meta: { file: fileForLog },
    });
  } catch (err) {
    const e = err as Error;
    serverLog("error", "hub", `hub 权限全开配置写入失败: ${e.message}`, {
      meta: { file: fileForLog, error: { name: e.name, message: e.message } },
    });
  }
}
