/**
 * N3.1/N3.2 经理半自主循环(soul flow 的克制版)。**默认关**(managerAutoWake)。
 *
 * 开启后:每 60s 扫一遍所有任务的子任务状态,发现"有子任务待合并(review-ready)
 * 或失败(failed/merge-conflict)"且该任务绑定的经理会话**空闲**时,往它注入一条
 * 自检提醒,让经理按 SOP 处理(提醒合并 / 诊断失败 / 汇总)。
 *
 * 严格保留闸口:这里**只注入文字提醒**,不替任何人合并、不开危险边界、不绕确认。
 * 真正的动作仍由经理 AI 走既有受约束路径(派工要凭证、危险后端硬拦、合并默认人工)。
 *
 * 复用 `POST /api/hub/dispatch-to-idle-session` 注入,继承它全部护栏(仅 claude、
 * 需 live PTY、waiting_input 拒、最近有人类输入拒、idle 原子抢占)——所以经理正在
 * 忙 / 大哥正在打字时不会被打扰,失败静默,下个 tick 再试。
 *
 * 未经活模型充分验证(大哥知情后要求现在就上)。冷却 + idle 护栏 + N3.3 重派熔断
 * 是它不至于失控烧 token 的三道兜底。
 */
import type { FastifyInstance } from "fastify";

import { getAppSettings } from "./app-settings.js";
import { findSessionBoundToTask } from "./db.js";
import { serverLog } from "./log-bus.js";
import { subtaskRuns } from "./task-subtasks-store.js";

const TICK_MS = 60_000;
const NUDGE_COOLDOWN_MS = 3 * 60_000;
const lastNudgeAt = new Map<string, number>();

let appRef: FastifyInstance | null = null;

/**
 * N4.1 子工反问经理:待经理回答的问题队列。子工写 ask 文件 → runner 转到这里 →
 * 投递给经理会话(经理把答复写进子工 worktree 的 answer 文件,子工轮询读到继续)。
 * 投递成功(经理空闲收下)即出队;经理忙则留队,tick 重试。
 */
interface PendingQuestion {
  projectId: string;
  taskName: string;
  subtaskId: number;
  worktreePath: string;
  question: string;
}
const pendingQuestions = new Map<string, PendingQuestion>();

function qKey(q: { projectId: string; taskName: string; subtaskId: number }): string {
  return `${q.projectId}::${q.taskName}::${q.subtaskId}`;
}

function buildQuestionNudge(q: PendingQuestion): string {
  const answerPath = `${q.worktreePath.replace(/\\/g, "/")}/.aimon/runtime/answer`;
  return (
    `[子工提问] 你管的任务「${q.taskName}」的子工 #${q.subtaskId} 卡在拿不准的地方,问:` +
    `\n「${q.question}」` +
    `\n请按经理 SOP 给个明确答复——用 Bash 执行:printf '%s' '你的答复' > "${answerPath}"。` +
    `子工正在轮询这个文件等你回话,别让它瞎猜。`
  );
}

/** runner 检测到子工 ask 文件后调本函数把问题入队,并立即尝试投递给经理。 */
export function addManagerQuestion(q: PendingQuestion): void {
  pendingQuestions.set(qKey(q), q);
  if (appRef) void flushQuestions(appRef);
}

async function flushQuestions(app: FastifyInstance): Promise<void> {
  for (const [key, q] of pendingQuestions) {
    const sess = findSessionBoundToTask(q.projectId, q.taskName);
    if (!sess || sess.agent !== "claude") continue; // 经理会话不在,留队下次
    let res;
    try {
      res = await app.inject({
        method: "POST",
        url: "/api/hub/dispatch-to-idle-session",
        payload: { targetSessionId: sess.id, text: buildQuestionNudge(q) },
      });
    } catch {
      continue;
    }
    if (res.statusCode === 200) {
      pendingQuestions.delete(key); // 经理收下了,出队
      serverLog("info", "manager", "子工提问已转交经理", {
        projectId: q.projectId,
        sessionId: sess.id,
        meta: { taskName: q.taskName, subtaskId: q.subtaskId },
      });
    }
    // 非 200(经理忙)→ 留队,下个 tick 再投
  }
}

interface TaskNeed {
  projectId: string;
  taskName: string;
  reviewReady: number;
  failed: number;
}

function buildNudge(e: TaskNeed): string {
  const bits: string[] = [];
  if (e.reviewReady > 0) bits.push(`${e.reviewReady} 个子任务待合并`);
  if (e.failed > 0) bits.push(`${e.failed} 个失败/冲突`);
  return (
    `[经理自检] 任务「${e.taskName}」有进度:${bits.join("、")}。` +
    `请按经理 SOP 处理——待合并的提醒大哥去面板放行(允许自动合并时可调 auto-approve-all);` +
    `失败的诊断原因(可能被危险边界硬拦,看 scope=manager 日志),决定重派还是升级给大哥;` +
    `全部合并后写白话总结。不要绕过确认/危险/合并闸口。`
  );
}

async function tick(app: FastifyInstance): Promise<void> {
  if (!getAppSettings().manager.autoWake) return;

  const tasks = new Map<string, TaskNeed>();
  for (const r of subtaskRuns.list()) {
    const key = `${r.projectId}::${r.taskName}`;
    let e = tasks.get(key);
    if (!e) {
      e = { projectId: r.projectId, taskName: r.taskName, reviewReady: 0, failed: 0 };
      tasks.set(key, e);
    }
    if (r.state === "review-ready") e.reviewReady += 1;
    else if (r.state === "failed" || r.state === "merge-conflict") e.failed += 1;
  }

  for (const [key, e] of tasks) {
    if (e.reviewReady === 0 && e.failed === 0) continue; // 没有需要经理处理的状态
    if (Date.now() - (lastNudgeAt.get(key) ?? 0) < NUDGE_COOLDOWN_MS) continue; // 冷却中
    const sess = findSessionBoundToTask(e.projectId, e.taskName);
    if (!sess || sess.agent !== "claude") continue; // 没绑经理会话 / 非 claude

    let res;
    try {
      res = await app.inject({
        method: "POST",
        url: "/api/hub/dispatch-to-idle-session",
        payload: { targetSessionId: sess.id, text: buildNudge(e) },
      });
    } catch {
      continue; // 注入异常,下个 tick 再试
    }
    if (res.statusCode === 200) {
      lastNudgeAt.set(key, Date.now());
      serverLog("info", "manager", "自动唤醒经理盯进度", {
        projectId: e.projectId,
        sessionId: sess.id,
        meta: { taskName: e.taskName, reviewReady: e.reviewReady, failed: e.failed },
      });
    }
    // 非 200(忙 / 刚有人输入 / 非 idle)→ 静默跳过,下个 tick 再试
  }
}

let started = false;

/** 启动经理自检 tick。幂等。计时器 unref,不挡进程退出。 */
export function startManagerTick(app: FastifyInstance): void {
  if (started) return;
  started = true;
  appRef = app;
  const timer = setInterval(() => {
    void tick(app);
    void flushQuestions(app); // 重投经理忙时积压的子工提问(与 autoWake 无关,始终跑)
  }, TICK_MS);
  timer.unref();
  serverLog("info", "manager", "经理自检 tick 已启动(默认关,需 autoWake 开启才动作)", {
    meta: { tickMs: TICK_MS, cooldownMs: NUDGE_COOLDOWN_MS },
  });
}
