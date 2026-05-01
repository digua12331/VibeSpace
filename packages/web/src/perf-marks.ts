import { pushLog } from './logs'

/**
 * 切项目的"开始 → 稳定"耗时探针。
 *
 * 时机近似：start = selectProject 入口；end = 双 raf（等浏览器画完下一帧）后。
 * 不等下游 fetch（fetch 完成不算"切换体感稳定"，画面不变化才算）。
 *
 * 所有结果通过 pushLog 进 LogsView + 落盘 JSONL，可直接筛 scope=perf。
 */

const MARK_START = 'project-switch:start'
const MARK_END = 'project-switch:end'
const MEASURE = 'project-switch'

interface SwitchEndCtx {
  fromProjectId: string | null
  toProjectId: string | null
  sessionsCount: number
  degraded: boolean
  evictedProjectIds?: string[]
  usedJSHeapSize?: number
}

let pending = false

export function markProjectSwitchStart(): void {
  if (typeof performance === 'undefined' || !performance.mark) return
  // 同一帧内反复切（用户连点）只保留最后一次的 start。
  try { performance.clearMarks(MARK_START) } catch { /* ignore */ }
  try { performance.mark(MARK_START) } catch { /* ignore */ }
  pending = true
}

export function markProjectSwitchEnd(ctx: SwitchEndCtx): void {
  if (typeof performance === 'undefined' || !performance.mark) return
  if (!pending) return
  pending = false

  // 双 raf：第一帧 React commit 后、第二帧浏览器 paint 完成。
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16)
  raf(() => raf(() => {
    let ms = 0
    try {
      performance.mark(MARK_END)
      const m = performance.measure(MEASURE, MARK_START, MARK_END)
      ms = Math.round(m.duration)
      performance.clearMarks(MARK_END)
      performance.clearMeasures(MEASURE)
    } catch {
      // mark 已被清掉等竞态，直接放弃这一次 measure。
      return
    }
    pushLog({
      level: 'info',
      scope: 'perf',
      msg: `project-switch 完成 (${ms}ms)`,
      projectId: ctx.toProjectId ?? undefined,
      meta: {
        ms,
        fromProjectId: ctx.fromProjectId,
        toProjectId: ctx.toProjectId,
        sessionsCount: ctx.sessionsCount,
        degraded: ctx.degraded,
        ...(ctx.evictedProjectIds ? { evictedProjectIds: ctx.evictedProjectIds } : {}),
        ...(ctx.usedJSHeapSize != null ? { usedJSHeapSize: ctx.usedJSHeapSize } : {}),
      },
    })
  }))
}

interface ChromiumPerfMemory {
  usedJSHeapSize?: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

/** Chrome / Edge / Electron 才有；其他浏览器返回 undefined（兜底不降级）。 */
export function readUsedJSHeapSize(): number | undefined {
  if (typeof performance === 'undefined') return undefined
  const mem = (performance as unknown as { memory?: ChromiumPerfMemory }).memory
  return typeof mem?.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : undefined
}

export const KEEPALIVE_MEM_THRESHOLD = 2 * 1024 ** 3
export const KEEPALIVE_LRU_LIMIT = 3
