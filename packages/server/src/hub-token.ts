/**
 * 进程级一次性 token：保护 /api/hub/* 路由不被同机的别 VibeSpace 实例
 * (e.g. dev=9787 vs stable=8787) 通过 hub MCP 误连。本机单用户场景下
 * 不是为防恶意攻击，是为防误打错实例。
 *
 * - 进程启动时生成一次，整个 server 生命周期不变；server 重启自动换新。
 * - 通过 X-Hub-Token header 传递。hub workspace 的 .mcp.json env 里也带
 *   这个 token，MCP server 子进程读 env 后回调时附在 header 上。
 * - 绝不写日志、绝不持久化到磁盘（除了 .mcp.json 这种 hub 自己用的临时文件）。
 */
import { randomBytes } from "node:crypto";

let currentToken = randomBytes(16).toString("hex");

export function getHubToken(): string {
  return currentToken;
}

export function regenerateHubToken(): string {
  currentToken = randomBytes(16).toString("hex");
  return currentToken;
}
