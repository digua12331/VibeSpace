import { useMemo, useState } from 'react'
import * as api from '../../api'
import { useStore } from '../../store'
import { logAction } from '../../logs'
import { alertDialog } from '../dialog/DialogHost'
import type { HubProject } from '../../types'

// MVP: hard-coded agent list covering the common case. Future Phase-2 work can
// pull this from /api/cli-installer/status or store.cliEntries for accuracy.
const AGENT_OPTIONS = ['claude', 'codex', 'gemini', 'shell']

interface Props {
  project: HubProject
  onClose: () => void
  onSuccess: (sessionId: string) => void
}

type Mode = 'new' | 'reuse'

export default function HubDispatchDialog({ project, onClose, onSuccess }: Props) {
  // 默认新建以降低误派概率 (Codex 第 14 点)
  const [mode, setMode] = useState<Mode>('new')
  const [agent, setAgent] = useState('claude')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 候选 idle session 列表 —— 前端 filter 仅作提示，后端再做权威判断
  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)
  const idleCandidates = useMemo(() => {
    return sessions.filter(
      (s) =>
        s.projectId === project.id
        && s.agent === 'claude'
        && s.ended_at == null
        && (liveStatus[s.id] ?? s.status) === 'idle',
    )
  }, [sessions, liveStatus, project.id])

  const [targetSessionId, setTargetSessionId] = useState<string>(
    idleCandidates[0]?.id ?? '',
  )

  async function onSubmit(): Promise<void> {
    if (!text.trim() || submitting) return
    if (mode === 'reuse' && !targetSessionId) return
    setSubmitting(true)
    try {
      if (mode === 'new') {
        const r = await logAction(
          'hub',
          'dispatch',
          () => api.hubDispatch({ targetProjectId: project.id, agent, text }),
          { projectId: project.id, meta: { agent, textLen: text.length } },
        )
        onSuccess(r.sessionId)
      } else {
        const r = await logAction(
          'hub',
          'dispatch-to-idle',
          () =>
            api.dispatchToIdleSession({ targetSessionId, text }),
          {
            projectId: project.id,
            sessionId: targetSessionId,
            meta: { textLen: text.length },
          },
        )
        onSuccess(r.sessionId)
      }
    } catch (e) {
      const err = e as Error & { code?: string; detail?: string }
      const codeHint = err.code ? ` (code: ${err.code})` : ''
      await alertDialog(`派任务失败: ${err.message}${codeHint}`, {
        title: '派任务失败',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    text.trim().length > 0
    && !submitting
    && (mode === 'new' || (mode === 'reuse' && !!targetSessionId))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-md shadow-flyout p-5 w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm text-fg mb-3">
          派任务到项目 <span className="font-medium">"{project.name}"</span>
        </div>

        {/* 模式选择 */}
        <div className="space-y-2 mb-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="dispatch-mode"
              value="new"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              disabled={submitting}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-fg">新建 session 跑任务</div>
              <div className="text-[11px] text-muted">
                在该项目下创建一个新终端 (推荐;不会干扰已有终端)
              </div>
            </div>
          </label>
          <label
            className={`flex items-start gap-2 text-sm cursor-pointer ${
              idleCandidates.length === 0 ? 'opacity-50' : ''
            }`}
          >
            <input
              type="radio"
              name="dispatch-mode"
              value="reuse"
              checked={mode === 'reuse'}
              onChange={() => setMode('reuse')}
              disabled={submitting || idleCandidates.length === 0}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-fg">
                派给已有空闲 claude 终端
                <span className="ml-2 text-[11px] text-subtle">
                  ({idleCandidates.length} 个候选)
                </span>
              </div>
              <div className="text-[11px] text-muted">
                复用已有 idle 终端;只有 claude + 真空闲 ≥800ms + 你最近 1s 没按键才会成功
              </div>
            </div>
          </label>
        </div>

        <div className="space-y-3">
          {mode === 'new' && (
            <div>
              <div className="text-xs text-muted mb-1">Agent (用哪个 AI / shell 跑)</div>
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                disabled={submitting}
                className="w-full bg-bg border border-border text-sm rounded px-2 py-1"
              >
                {AGENT_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          )}
          {mode === 'reuse' && (
            <div>
              <div className="text-xs text-muted mb-1">
                目标 session (claude + idle)
              </div>
              <select
                value={targetSessionId}
                onChange={(e) => setTargetSessionId(e.target.value)}
                disabled={submitting || idleCandidates.length === 0}
                className="w-full bg-bg border border-border text-sm rounded px-2 py-1 font-mono"
              >
                {idleCandidates.length === 0 && (
                  <option value="">无符合条件的 session</option>
                )}
                {idleCandidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id.slice(0, 8)} · idle
                    {s.task ? ` · task=${s.task}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div className="text-xs text-muted mb-1">任务指令 (作为输入发送给 session)</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={submitting}
              placeholder="例: 列一下当前目录文件 / 帮我跑测试 / 看下最近 3 个 commit"
              rows={4}
              className="w-full bg-bg border border-border text-sm rounded px-2 py-1 font-mono"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="fluent-btn px-3 py-1 text-sm rounded border border-border hover:bg-white/[0.04]"
          >
            取消
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={!canSubmit}
            className="fluent-btn px-3 py-1 text-sm rounded border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {submitting ? '派工中…' : '提交派工'}
          </button>
        </div>
      </div>
    </div>
  )
}
