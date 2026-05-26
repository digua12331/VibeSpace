/**
 * 项目级 AI 终端内存占用实时统计 —— 每 10s 拉一次系统进程快照，按项目汇总
 * 进程树的 WorkingSet（驻留内存），broadcast 给所有 WS 客户端。前端把数字渲
 * 染到 ProjectsColumn 每个项目行末尾。
 *
 * 设计要点：
 *  - **单次 CIM 查询 + 8s 超时**：在繁忙机器上 Get-CimInstance 可能慢到几秒，
 *    每 tick 只查 1 次（而不是逐进程查 N 次）+ 硬超时，保证不阻塞主流程；
 *    超时则丢弃这一 tick，前端保留旧值。
 *  - **空跑短路**：无 alive AI 会话 → 直接 return，连 powershell 都不起。
 *    后台开着 VibeSpace 但没用 AI 时零开销。
 *  - **AI 会话定义**：alive session 中 agent ∉ BUILTIN_SHELL_AGENTS（cmd/pwsh/shell
 *    单独的 shell 进程不算 AI）。
 *  - **进程树**：每个 session.pid 走 BFS 收集所有后代（Claude/Codex 会派生
 *    node + MCP server + hook 等子进程，真正吃内存在子树里），WorkingSet 求和。
 *  - **日志规则**：ticker start/stop 各打一条 info；CIM 失败按 60s 节流打 error；
 *    成功 tick 不打日志（参 auto.md "高频事件不要逐次记日志"）。
 *
 * 跨平台：仅 Windows。其它平台 powershell 找不到 → 每 tick 静默失败 → 前端
 * 永远拿不到数据 → 项目行不显示数字，优雅降级，不影响主流程。
 */
import { spawn } from "node:child_process";
import { BUILTIN_SHELL_AGENTS, getSession } from "./db.js";
import { ptyManager } from "./pty-manager.js";
import { broadcast } from "./ws-hub.js";
import { serverLog } from "./log-bus.js";

const TICK_MS = 10_000;
const CIM_TIMEOUT_MS = 8_000;
const FAIL_LOG_THROTTLE_MS = 60_000;
const SHELL_SET = new Set<string>(BUILTIN_SHELL_AGENTS);

interface ProcInfo {
  parent: number;
  ws: number;
}

let timer: NodeJS.Timeout | null = null;
let lastFailLoggedAt = 0;
// 最近一次 tick 算出的项目→字节映射，供 HTTP 路由（如 /api/hub/status）同步读取。
// WS 广播是推送模型；这里加一个"读快照"的旁路给非订阅消费方用。
let lastByProject: Record<string, number> = {};

/**
 * 跑一次 powershell + Get-CimInstance，返回 PID→{parent, workingSet} 的映射。
 * 超时 / 进程崩溃 / 非零退出 / JSON 解析失败 → 一律返回 null（调用方按"这一
 * 拍没数据"处理）。
 */
function snapshotProcesses(): Promise<Map<number, ProcInfo> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: Map<number, ProcInfo> | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      try {
        ps.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve(v);
    };

    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-CimInstance Win32_Process -OperationTimeoutSec 7 -ErrorAction SilentlyContinue | Select ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress",
      ],
      { windowsHide: true },
    );

    const killTimer = setTimeout(() => finish(null), CIM_TIMEOUT_MS);
    let stdout = "";
    ps.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    ps.on("error", () => finish(null));
    ps.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        finish(null);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const map = new Map<number, ProcInfo>();
        for (const r of list) {
          if (!r || typeof r !== "object") continue;
          const row = r as Record<string, unknown>;
          const pid = Number(row.ProcessId);
          const ppid = Number(row.ParentProcessId);
          const ws = Number(row.WorkingSetSize);
          if (!Number.isFinite(pid) || pid <= 0) continue;
          map.set(pid, {
            parent: Number.isFinite(ppid) ? ppid : 0,
            ws: Number.isFinite(ws) ? ws : 0,
          });
        }
        finish(map);
      } catch {
        finish(null);
      }
    });
  });
}

function buildChildIndex(procs: Map<number, ProcInfo>): Map<number, number[]> {
  const idx = new Map<number, number[]>();
  for (const [pid, info] of procs) {
    const arr = idx.get(info.parent);
    if (arr) arr.push(pid);
    else idx.set(info.parent, [pid]);
  }
  return idx;
}

function sumTree(
  root: number,
  procs: Map<number, ProcInfo>,
  childIndex: Map<number, number[]>,
): number {
  let total = 0;
  const queue: number[] = [root];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue; // 防 PID 复用 / 异常循环
    seen.add(pid);
    const info = procs.get(pid);
    if (!info) continue;
    total += info.ws;
    const kids = childIndex.get(pid);
    if (kids) for (const k of kids) queue.push(k);
  }
  return total;
}

async function tick(): Promise<void> {
  // 1) 短路：无 alive 会话直接 return，连 powershell 都不起。
  const aliveIds = ptyManager.listAlive();
  if (aliveIds.length === 0) return;

  // 2) 过滤出"AI 会话"并取 PID + projectId。
  const roots: Array<{ pid: number; projectId: string }> = [];
  for (const sid of aliveIds) {
    const row = getSession(sid);
    if (!row) continue;
    if (SHELL_SET.has(row.agent)) continue;
    const pid = ptyManager.getPid(sid);
    if (!pid) continue;
    roots.push({ pid, projectId: row.projectId });
  }
  if (roots.length === 0) return;

  // 3) 快照 + 求和
  const procs = await snapshotProcesses();
  if (!procs) {
    const now = Date.now();
    if (now - lastFailLoggedAt > FAIL_LOG_THROTTLE_MS) {
      lastFailLoggedAt = now;
      serverLog(
        "error",
        "mem-stats",
        "CIM 进程快照超时或失败 (60s 内重复已抑制)",
      );
    }
    return;
  }
  const childIndex = buildChildIndex(procs);
  const byProject: Record<string, number> = {};
  for (const r of roots) {
    const sum = sumTree(r.pid, procs, childIndex);
    byProject[r.projectId] = (byProject[r.projectId] ?? 0) + sum;
  }

  // 4) 更新快照 + 广播。无 client 时 broadcast 是 no-op（ws-hub 行为）。
  lastByProject = byProject;
  broadcast({ type: "mem-stats", byProject, ts: Date.now() });
}

/**
 * 读最近一次 tick 的 project→bytes 快照。/api/hub/status 这种同步 HTTP
 * 路由用它拼聚合响应，不必再订阅 WS。返回浅拷贝防外部改。
 */
export function getMemByProject(): Record<string, number> {
  return { ...lastByProject };
}

export function startProcessMemTicker(): void {
  if (timer) return;
  serverLog("info", "mem-stats", `ticker-start (interval=${TICK_MS / 1000}s)`);
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // unref：本 ticker 不应阻止 Node 进程退出；shutdown 钩子另行调 stop。
  timer.unref();
}

export function stopProcessMemTicker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  serverLog("info", "mem-stats", "ticker-stop");
}
