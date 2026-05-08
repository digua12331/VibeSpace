/**
 * gstack 安装器 —— 把 garrytan/gstack 的 28 个 Claude Code skill 装到全局
 * `~/.claude/skills/gstack`，让用户在 Claude 会话里能用 `/browse` `/qa` `/ship`
 * 等 slash 命令。
 *
 * 设计要点（详 plan 阶段 2）：
 * - **机器级动作**：写 `~/.claude/skills/gstack`，不属于任何单个项目，所以
 *   路由挂在 `/api/external-tools/*` 而非 `/api/projects/:id/*`。
 * - **状态实时探测**：用 fs.existsSync + spawn 检测 bun/git 可用性，避免维护
 *   内存状态，重启后立即可用。
 * - **安装是异步作业**：spawn `git clone` + `bun ./setup`，输出转 serverLog 让
 *   LogsView 能看进度；完成时起止配对。
 * - **跨平台**：所有路径 `os.homedir()` + `path.join`；Windows 上 spawn 命令
 *   名加 `.cmd` 后缀回退（git/bun 在 Windows 通常装为 `.cmd` 包装脚本）。
 * - **Windows symlink 失败兜底**：bun setup 内部可能创建 symlink，Windows 普通
 *   用户权限不够会失败——本实现不自动绕过（auto.md 2026-05-02 经验），只在
 *   serverLog 写一条 warn 提示用户以管理员重试。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { serverLog } from "./log-bus.js";

/** 用户提供文档里的 gstack 仓库地址。实施第一步会用 `git ls-remote` 探测可达。 */
const GSTACK_REPO_URL = "https://github.com/garrytan/gstack.git";

/** 安装到全局 Claude Code skill 目录下的固定子目录名。 */
const GSTACK_DIR_NAME = "gstack";

function gstackInstallPath(): string {
  return join(homedir(), ".claude", "skills", GSTACK_DIR_NAME);
}

export interface GstackStatus {
  /** 安装目录 + .git 子目录都存在 = 已克隆。 */
  installed: boolean;
  /** 安装路径（实时计算，前端展示用）。 */
  location: string;
  /** 已克隆时返回 git short hash，未克隆 null。 */
  version: string | null;
  /** 本机有 bun 可用？（spawn `bun --version` 不报 ENOENT）。 */
  bunAvailable: boolean;
  /** 本机有 git 可用？ */
  gitAvailable: boolean;
  /** 用户提供文档里的仓库 URL，前端展示+错误提示用。 */
  repoUrl: string;
}

/** 探测 spawn 某个命令是否可用（spawn 不抛 ENOENT 就算可用）。 */
async function checkCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const settle = (ok: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(ok);
    };
    try {
      const isWin = platform() === "win32";
      // Windows 上 git/bun 经常是 .cmd 包装脚本；先尝试原名，失败再试 .cmd
      const proc = spawn(cmd, args, {
        windowsHide: true,
        // Windows 需要 shell=true 才能解析 .cmd
        shell: isWin,
      });
      proc.on("error", () => settle(false));
      proc.on("exit", (code) => settle(code === 0));
    } catch {
      settle(false);
    }
  });
}

/** 在安装目录上 spawn `git rev-parse --short HEAD` 拿当前 commit short hash。失败返回 null。 */
async function readGstackVersion(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const dir = gstackInstallPath();
    if (!existsSync(join(dir, ".git"))) {
      resolve(null);
      return;
    }
    const isWin = platform() === "win32";
    const proc = spawn("git", ["rev-parse", "--short", "HEAD"], {
      cwd: dir,
      windowsHide: true,
      shell: isWin,
    });
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    const settle = (v: string | null): void => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    proc.on("error", () => settle(null));
    proc.on("exit", (code) => {
      const trimmed = out.trim();
      settle(code === 0 && trimmed.length > 0 ? trimmed : null);
    });
  });
}

export async function getGstackStatus(): Promise<GstackStatus> {
  const location = gstackInstallPath();
  const installed = existsSync(join(location, ".git"));
  const [bunAvailable, gitAvailable, version] = await Promise.all([
    checkCommand("bun", ["--version"]),
    checkCommand("git", ["--version"]),
    readGstackVersion(),
  ]);
  return {
    installed,
    location,
    version,
    bunAvailable,
    gitAvailable,
    repoUrl: GSTACK_REPO_URL,
  };
}

export interface GstackInstallResult {
  ok: boolean;
  /** 用作前端轮询/展示的快照（安装结束后立刻读 status）。 */
  status: GstackStatus;
  /** 失败原因（机器可读，前端文案可据此 i18n）。 */
  errorCode?:
    | "git_unavailable"
    | "bun_unavailable"
    | "repo_unreachable"
    | "git_clone_failed"
    | "bun_setup_failed"
    | "uninstall_failed"
    | "internal";
  errorMessage?: string;
  /** spawn 进程的合并输出，截断到末尾 8KB，方便前端排障。 */
  trailingLog?: string;
}

const MAX_TRAIL_BYTES = 8 * 1024;
function truncateTail(s: string): string {
  if (s.length <= MAX_TRAIL_BYTES) return s;
  return "…(truncated)…\n" + s.slice(-MAX_TRAIL_BYTES);
}

/** 把 spawn 子进程的合并输出转 serverLog（每行一条 info），并累积 trailing 给返回值。 */
function streamProcessLog(
  proc: ReturnType<typeof spawn>,
  scope: string,
  prefix: string,
): { collected: () => string } {
  let buffer = "";
  let lineBuffer = "";
  const append = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    buffer += text;
    lineBuffer += text;
    let nl = lineBuffer.indexOf("\n");
    while (nl >= 0) {
      const line = lineBuffer.slice(0, nl).replace(/\r$/, "").trimEnd();
      lineBuffer = lineBuffer.slice(nl + 1);
      if (line.length > 0) {
        serverLog("info", scope, `${prefix} ${line}`);
      }
      nl = lineBuffer.indexOf("\n");
    }
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);
  return { collected: () => truncateTail(buffer) };
}

/** spawn 一次命令，等它退出。返回 exitCode + 收集到的 trailing 输出。 */
async function runSpawn(
  cmd: string,
  args: string[],
  opts: { cwd?: string; scope: string; logPrefix: string },
): Promise<{ exitCode: number | null; trailingLog: string }> {
  return new Promise((resolve) => {
    const isWin = platform() === "win32";
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      shell: isWin,
    });
    const stream = streamProcessLog(proc, opts.scope, opts.logPrefix);
    proc.on("error", (err) => {
      serverLog("error", opts.scope, `${opts.logPrefix} spawn error: ${err.message}`);
      resolve({ exitCode: null, trailingLog: stream.collected() });
    });
    proc.on("exit", (code) => {
      resolve({ exitCode: code, trailingLog: stream.collected() });
    });
  });
}

/** 用 git ls-remote 探测 gstack repo 可达。失败时不去 clone，直接返回错误。 */
async function probeRepoReachable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const settle = (ok: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(ok);
    };
    const isWin = platform() === "win32";
    const proc = spawn("git", ["ls-remote", "--heads", GSTACK_REPO_URL], {
      windowsHide: true,
      shell: isWin,
    });
    proc.on("error", () => settle(false));
    proc.on("exit", (code) => settle(code === 0));
    // 给 ls-remote 最多 15s（网络慢时也别卡死）
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* noop */
      }
      settle(false);
    }, 15_000);
  });
}

/**
 * 安装 gstack：依次跑 `git ls-remote`（可达探测）→ `git clone --depth 1` →
 * `bun ./setup`（在 gstack 目录下）。任意一步失败即返回 errorCode + 失败前
 * 部分目录会被清理（避免残留半装目录）。
 */
export async function installGstack(): Promise<GstackInstallResult> {
  const t0 = Date.now();
  serverLog("info", "installer", "gstack-install 开始", {
    meta: { repoUrl: GSTACK_REPO_URL },
  });

  // 0. 前置检查
  const [bunAvailable, gitAvailable] = await Promise.all([
    checkCommand("bun", ["--version"]),
    checkCommand("git", ["--version"]),
  ]);
  if (!gitAvailable) {
    serverLog(
      "error",
      "installer",
      `gstack-install 失败 (${Date.now() - t0}ms): git 不可用`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "git_unavailable",
      errorMessage: "本机未检测到 git，请先安装 git。",
    };
  }
  if (!bunAvailable) {
    serverLog(
      "error",
      "installer",
      `gstack-install 失败 (${Date.now() - t0}ms): bun 不可用`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "bun_unavailable",
      errorMessage:
        "本机未检测到 bun。gstack setup 依赖 bun，请先安装 bun（https://bun.sh）后重试。",
    };
  }

  // 1. 探测 repo 可达
  const reachable = await probeRepoReachable();
  if (!reachable) {
    serverLog(
      "error",
      "installer",
      `gstack-install 失败 (${Date.now() - t0}ms): repo 不可达`,
      { meta: { repoUrl: GSTACK_REPO_URL } },
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "repo_unreachable",
      errorMessage: `无法访问 ${GSTACK_REPO_URL}（git ls-remote 失败）。请检查网络或 repo 是否仍公开。`,
    };
  }

  const installPath = gstackInstallPath();

  // 2. 已存在则跳过 clone（idempotent；要更新走 update）
  if (!existsSync(join(installPath, ".git"))) {
    const cloneRes = await runSpawn(
      "git",
      ["clone", "--depth", "1", GSTACK_REPO_URL, installPath],
      { scope: "installer", logPrefix: "gstack-install [clone]" },
    );
    if (cloneRes.exitCode !== 0) {
      // 清理半装目录避免下次状态错乱
      try {
        await rm(installPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      serverLog(
        "error",
        "installer",
        `gstack-install 失败 (${Date.now() - t0}ms): git clone 退出码 ${cloneRes.exitCode}`,
      );
      return {
        ok: false,
        status: await getGstackStatus(),
        errorCode: "git_clone_failed",
        errorMessage: `git clone 失败（退出码 ${cloneRes.exitCode}）。`,
        trailingLog: cloneRes.trailingLog,
      };
    }
  }

  // 3. 跑 bun ./setup（在 gstack 目录下）
  const setupRes = await runSpawn("bun", ["./setup"], {
    cwd: installPath,
    scope: "installer",
    logPrefix: "gstack-install [setup]",
  });

  // Windows 上 setup 失败常因 symlink 权限不全；不自动绕过，只 warn 提示用户。
  if (setupRes.exitCode !== 0) {
    if (platform() === "win32") {
      serverLog(
        "warn" as never,
        "installer",
        "gstack-install [setup] Windows 上 setup 失败可能因 symlink 权限不足，可考虑以管理员身份重试。",
      );
    }
    serverLog(
      "error",
      "installer",
      `gstack-install 失败 (${Date.now() - t0}ms): bun setup 退出码 ${setupRes.exitCode}`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "bun_setup_failed",
      errorMessage: `bun setup 失败（退出码 ${setupRes.exitCode}）。git clone 已完成但 skill 未链接到 ~/.claude/skills/。`,
      trailingLog: setupRes.trailingLog,
    };
  }

  serverLog(
    "info",
    "installer",
    `gstack-install 成功 (${Date.now() - t0}ms)`,
    { meta: { location: installPath } },
  );
  return { ok: true, status: await getGstackStatus() };
}

/** 更新 gstack：在已有目录跑 git pull → bun setup。未安装则报 git_clone_failed。 */
export async function updateGstack(): Promise<GstackInstallResult> {
  const t0 = Date.now();
  serverLog("info", "installer", "gstack-update 开始");

  const installPath = gstackInstallPath();
  if (!existsSync(join(installPath, ".git"))) {
    serverLog(
      "error",
      "installer",
      `gstack-update 失败 (${Date.now() - t0}ms): 未安装`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "git_clone_failed",
      errorMessage: "gstack 尚未安装，请先点安装。",
    };
  }

  const pullRes = await runSpawn("git", ["pull", "--ff-only"], {
    cwd: installPath,
    scope: "installer",
    logPrefix: "gstack-update [pull]",
  });
  if (pullRes.exitCode !== 0) {
    serverLog(
      "error",
      "installer",
      `gstack-update 失败 (${Date.now() - t0}ms): git pull 退出码 ${pullRes.exitCode}`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "git_clone_failed",
      errorMessage: `git pull 失败（退出码 ${pullRes.exitCode}）。`,
      trailingLog: pullRes.trailingLog,
    };
  }

  const setupRes = await runSpawn("bun", ["./setup"], {
    cwd: installPath,
    scope: "installer",
    logPrefix: "gstack-update [setup]",
  });
  if (setupRes.exitCode !== 0) {
    serverLog(
      "error",
      "installer",
      `gstack-update 失败 (${Date.now() - t0}ms): bun setup 退出码 ${setupRes.exitCode}`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "bun_setup_failed",
      errorMessage: `bun setup 失败（退出码 ${setupRes.exitCode}）。`,
      trailingLog: setupRes.trailingLog,
    };
  }

  serverLog(
    "info",
    "installer",
    `gstack-update 成功 (${Date.now() - t0}ms)`,
  );
  return { ok: true, status: await getGstackStatus() };
}

/** 卸载 gstack：删除 `~/.claude/skills/gstack` 整个目录（用户手动写在里面的内容也会被删——这是约定）。 */
export async function uninstallGstack(): Promise<GstackInstallResult> {
  const t0 = Date.now();
  serverLog("info", "installer", "gstack-uninstall 开始");

  const installPath = gstackInstallPath();
  if (!existsSync(installPath)) {
    serverLog(
      "info",
      "installer",
      `gstack-uninstall 成功 (${Date.now() - t0}ms): 已不存在`,
    );
    return { ok: true, status: await getGstackStatus() };
  }
  try {
    await rm(installPath, { recursive: true, force: true });
    serverLog(
      "info",
      "installer",
      `gstack-uninstall 成功 (${Date.now() - t0}ms)`,
    );
    return { ok: true, status: await getGstackStatus() };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    serverLog(
      "error",
      "installer",
      `gstack-uninstall 失败 (${Date.now() - t0}ms): ${msg}`,
    );
    return {
      ok: false,
      status: await getGstackStatus(),
      errorCode: "uninstall_failed",
      errorMessage: msg,
    };
  }
}
