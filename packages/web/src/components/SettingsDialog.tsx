import { useEffect, useState } from 'react'
import {
  getAppSettings,
  updateAppSettings,
  getFeishuConfig,
  updateFeishuConfig,
  getFeishuStatus,
  testFeishu,
} from '../api'
import { logAction } from '../logs'
import { currentPermission, requestPermission } from '../notify'
import { useStore } from '../store'
import type {
  AppSettings,
  HibernationSettings,
  KeyCombo,
  TerminalKeybindings,
  FeishuStatus,
  FeishuTestResult,
} from '../types'

/**
 * Imperative open API — keeps the dialog mounted once at the workbench root
 * and lets any button toggle it without prop-drilling. Mirrors the pattern in
 * DialogHost (listeners + module-level state) but the body is fully custom
 * because DialogHost only supports alert/confirm/prompt.
 */
const listeners = new Set<(open: boolean) => void>()
let _open = false

function setOpenState(next: boolean) {
  _open = next
  for (const l of listeners) l(next)
}

export function openSettings(): void {
  setOpenState(true)
}

const RETENTION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 天' },
  { value: 3, label: '3 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 0, label: '不清理' },
]

type SettingsTab = 'general' | 'terminal' | 'feishu'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'terminal', label: '终端' },
  { id: 'feishu', label: '飞书机器人' },
]

const DEFAULT_HIBERNATION: HibernationSettings = {
  enabled: false,
  idleMinutes: 15,
  includeShells: false,
}

const DEFAULT_KEYBINDINGS: TerminalKeybindings = {
  abortAltKey: null,
  interruptAltKey: null,
}

// --- Keybinding helpers (frontend mirror of the backend rules in
// app-settings.ts::keyComboError — kept as a small local copy on purpose). ---

const MODIFIER_KEY_NAMES = new Set([
  'Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph',
  'CapsLock', 'ContextMenu', 'Dead', 'Process', 'Unidentified',
])
const TUI_RESERVED_KEYS = new Set([
  'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Backspace', 'Home', 'End', 'PageUp', 'PageDown',
])

function eventToCombo(e: KeyboardEvent): KeyCombo {
  const combo: KeyCombo = { key: e.key }
  if (e.ctrlKey) combo.ctrl = true
  if (e.altKey) combo.alt = true
  if (e.shiftKey) combo.shift = true
  if (e.metaKey) combo.meta = true
  return combo
}

/** Returns a reason string if the combo is not allowed, else null. */
function comboError(c: KeyCombo): string | null {
  const key = c.key
  if (!key) return '按键为空'
  if (MODIFIER_KEY_NAMES.has(key)) return '不能只用修饰键'
  if (key === 'Escape') return '不能用 Esc（已是默认中止键）'
  if (TUI_RESERVED_KEYS.has(key)) return `不能用 ${key}（终端导航保留键）`
  const ctrl = c.ctrl === true, alt = c.alt === true, meta = c.meta === true
  if (ctrl && !alt && !meta && (key === 'c' || key === 'C'))
    return '不能用 Ctrl+C（已是默认强制中断键）'
  if ((ctrl || meta) && (key === 'v' || key === 'V'))
    return '不能用粘贴快捷键'
  if (key.length === 1 && !ctrl && !alt && !meta)
    return '单个字符键太容易误触，请加 Ctrl/Alt 修饰或用 F1–F12'
  return null
}

function combosEqual(a: KeyCombo | null, b: KeyCombo | null): boolean {
  if (!a || !b) return false
  return (
    a.key === b.key &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift &&
    !!a.meta === !!b.meta
  )
}

/** Human-readable label, e.g. "Ctrl+Alt+F8". */
function formatCombo(c: KeyCombo | null): string {
  if (!c) return '未设置'
  const parts: string[] = []
  if (c.ctrl) parts.push('Ctrl')
  if (c.alt) parts.push('Alt')
  if (c.shift) parts.push('Shift')
  if (c.meta) parts.push('Meta')
  parts.push(c.key === ' ' ? 'Space' : c.key)
  return parts.join('+')
}

type RecordTarget = 'abortAltKey' | 'interruptAltKey'

export default function SettingsDialog() {
  const [open, setOpen] = useState(_open)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retention, setRetention] = useState<number>(1)
  const [hibernation, setHibernation] =
    useState<HibernationSettings>(DEFAULT_HIBERNATION)
  const [requestingNotify, setRequestingNotify] = useState(false)
  const [keybindings, setKeybindings] =
    useState<TerminalKeybindings>(DEFAULT_KEYBINDINGS)
  const [recording, setRecording] = useState<RecordTarget | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  // 飞书桥配置（独立加载 / 独立保存，走 /api/feishu/*，不跟上面的「保存」按钮共用）
  const [feishuEnabled, setFeishuEnabled] = useState(false)
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuDomain, setFeishuDomain] = useState<'feishu' | 'lark'>('feishu')
  const [feishuOwnerOpenId, setFeishuOwnerOpenId] = useState('')
  const [feishuAllowOpenIds, setFeishuAllowOpenIds] = useState('')
  const [feishuAllowChatIds, setFeishuAllowChatIds] = useState('')
  const [feishuSecretInput, setFeishuSecretInput] = useState('')
  const [feishuSecretMask, setFeishuSecretMask] = useState('')
  const [feishuHasSecret, setFeishuHasSecret] = useState(false)
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus | null>(null)
  const [feishuSaving, setFeishuSaving] = useState(false)
  const [feishuTesting, setFeishuTesting] = useState(false)
  const [feishuTestResult, setFeishuTestResult] =
    useState<FeishuTestResult | null>(null)
  const [feishuError, setFeishuError] = useState<string | null>(null)
  const notifyPerm = useStore((s) => s.notifyPerm)
  const setNotifyPerm = useStore((s) => s.setNotifyPerm)
  const setTerminalKeybindings = useStore((s) => s.setTerminalKeybindings)

  useEffect(() => {
    const l = (next: boolean) => setOpen(next)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // 打开设置时重新同步浏览器通知权限（用户可能在浏览器设置里改过）。
    setNotifyPerm(currentPermission())
    setLoading(true)
    setError(null)
    getAppSettings()
      .then((s: AppSettings) => {
        setRetention(s.pasteImageRetentionDays)
        setHibernation(s.hibernation ?? DEFAULT_HIBERNATION)
        setKeybindings(s.terminalKeybindings ?? DEFAULT_KEYBINDINGS)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
    // 飞书配置独立加载（失败不挡上面的应用设置）
    setFeishuError(null)
    setFeishuTestResult(null)
    setFeishuSecretInput('')
    getFeishuConfig()
      .then((c) => {
        setFeishuEnabled(c.enabled)
        setFeishuAppId(c.appId)
        setFeishuDomain(c.domain)
        setFeishuOwnerOpenId(c.ownerOpenId)
        setFeishuAllowOpenIds(c.allowOpenIds.join('\n'))
        setFeishuAllowChatIds(c.allowChatIds.join('\n'))
        setFeishuHasSecret(c.hasSecret)
        setFeishuSecretMask(c.appSecretMask)
      })
      .catch((e: unknown) =>
        setFeishuError(e instanceof Error ? e.message : String(e)),
      )
    getFeishuStatus()
      .then(setFeishuStatus)
      .catch(() => setFeishuStatus(null))
  }, [open, setNotifyPerm])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpenState(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Capture-phase key recorder. Runs only while a slot is being recorded.
  // Capture + stopPropagation means the dialog's own Escape-to-close listener
  // (bubble phase) never fires here — Esc during recording just cancels.
  useEffect(() => {
    if (!recording) return
    const target: RecordTarget = recording
    function onRecord(e: KeyboardEvent) {
      // Wait for a real (non-modifier) key so "hold Ctrl then press F8" works.
      if (MODIFIER_KEY_NAMES.has(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = eventToCombo(e)
      const err = comboError(combo)
      if (err) {
        setKeyError(err)
        setRecording(null)
        return
      }
      const other =
        target === 'abortAltKey'
          ? keybindings.interruptAltKey
          : keybindings.abortAltKey
      if (combosEqual(combo, other)) {
        setKeyError('两个备用键不能设成同一个组合')
        setRecording(null)
        return
      }
      setKeybindings((kb) => ({ ...kb, [target]: combo }))
      setKeyError(null)
      setRecording(null)
    }
    window.addEventListener('keydown', onRecord, true)
    return () => window.removeEventListener('keydown', onRecord, true)
  }, [recording, keybindings])

  // Closing the dialog (overlay click / cancel) must abort any in-flight
  // recording so the capture listener doesn't linger.
  useEffect(() => {
    if (!open) {
      setRecording(null)
      setKeyError(null)
    }
  }, [open])

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const next = await logAction(
        'settings',
        'update-app-settings',
        () =>
          updateAppSettings({
            pasteImageRetentionDays: retention,
            hibernation,
            terminalKeybindings: keybindings,
          }),
        {
          meta: {
            retentionDays: retention,
            hibernation,
            terminalKeybindings: keybindings,
          },
        },
      )
      // Push the saved bindings into the store so live terminals pick them up
      // immediately without a page reload.
      setTerminalKeybindings(next.terminalKeybindings ?? keybindings)
      setOpenState(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function onRequestNotify() {
    setRequestingNotify(true)
    try {
      await logAction('settings', 'request-notify-permission', async () => {
        const next = await requestPermission()
        setNotifyPerm(next)
        return next
      })
    } finally {
      setRequestingNotify(false)
    }
  }

  function parseIdLines(text: string): string[] {
    return text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  async function onSaveFeishu() {
    setFeishuSaving(true)
    setFeishuError(null)
    setFeishuTestResult(null)
    try {
      const next = await logAction(
        'feishu',
        'save-config',
        () =>
          updateFeishuConfig({
            enabled: feishuEnabled,
            appId: feishuAppId.trim(),
            domain: feishuDomain,
            ownerOpenId: feishuOwnerOpenId.trim(),
            allowOpenIds: parseIdLines(feishuAllowOpenIds),
            allowChatIds: parseIdLines(feishuAllowChatIds),
            // 留空 = 不改已存的密钥；填了才提交
            ...(feishuSecretInput.trim() ? { appSecret: feishuSecretInput.trim() } : {}),
          }),
        {
          meta: {
            enabled: feishuEnabled,
            domain: feishuDomain,
            secretChanged: !!feishuSecretInput.trim(),
          },
        },
      )
      setFeishuEnabled(next.enabled)
      setFeishuAppId(next.appId)
      setFeishuDomain(next.domain)
      setFeishuOwnerOpenId(next.ownerOpenId)
      setFeishuAllowOpenIds(next.allowOpenIds.join('\n'))
      setFeishuAllowChatIds(next.allowChatIds.join('\n'))
      setFeishuHasSecret(next.hasSecret)
      setFeishuSecretMask(next.appSecretMask)
      setFeishuSecretInput('')
      // 保存后刷新在线状态（后端会按新配置重连）
      getFeishuStatus().then(setFeishuStatus).catch(() => undefined)
    } catch (e: unknown) {
      setFeishuError(e instanceof Error ? e.message : String(e))
    } finally {
      setFeishuSaving(false)
    }
  }

  async function onTestFeishu() {
    setFeishuTesting(true)
    setFeishuTestResult(null)
    setFeishuError(null)
    try {
      const result = await logAction('feishu', 'test-connection', () =>
        testFeishu({
          appId: feishuAppId.trim(),
          domain: feishuDomain,
          ...(feishuSecretInput.trim() ? { appSecret: feishuSecretInput.trim() } : {}),
        }),
      )
      setFeishuTestResult(result)
    } catch (e: unknown) {
      setFeishuError(e instanceof Error ? e.message : String(e))
    } finally {
      setFeishuTesting(false)
    }
  }

  if (!open) return null

  const notifyTone =
    notifyPerm === 'granted'
      ? 'text-emerald-300 border-emerald-600/40 bg-emerald-500/10'
      : notifyPerm === 'denied' || notifyPerm === 'unsupported'
        ? 'text-rose-300 border-rose-600/40 bg-rose-500/10'
        : 'text-muted border-border'
  const notifyLabel =
    notifyPerm === 'granted'
      ? '已启用'
      : notifyPerm === 'denied'
        ? '被拒绝（请在浏览器设置中开启）'
        : notifyPerm === 'unsupported'
          ? '此浏览器不支持'
          : '未启用'

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm flex items-center justify-center animate-fluent-in"
      onClick={() => !saving && setOpenState(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[720px] max-w-[90vw] h-[600px] max-h-[88vh] overflow-hidden fluent-acrylic rounded-win shadow-dialog"
      >
        {/* 左侧页签列 */}
        <div className="w-[150px] shrink-0 border-r border-border/40 p-3 flex flex-col gap-1">
          <div className="text-[15px] font-display font-semibold mb-2 px-1">设置</div>
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                activeTab === t.id
                  ? 'bg-accent/15 text-fg border border-accent/40'
                  : 'text-muted hover:text-fg hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'general' && (
        <section className="mb-4">
          <div className="text-sm text-fg/90 mb-1">粘贴图片保留天数</div>
          <div className="text-xs text-muted mb-2">
            粘贴到对话里的图片存在每个项目的 .vibespace/pasted-images
            目录。后端每次启动时会清理超过保留天数的图。"不清理"表示不删任何旧图。
          </div>
          <select
            disabled={loading || saving}
            value={retention}
            onChange={(e) => setRetention(Number(e.target.value))}
            className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60"
          >
            {RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </section>
        )}

        {activeTab === 'terminal' && (
        <section className="mb-4">
          <div className="text-sm text-fg/90 mb-1">会话冬眠</div>
          <div className="text-xs text-muted mb-2 leading-relaxed">
            空闲超过阈值的 AI 终端会被自动杀掉后端 CLI 进程释放内存，tab 在前端变成 💤 紫色；点 tab
            后会重新启动一个新的 CLI 进程接管。
            <span className="text-amber-300/80">
              {' '}
              冬眠会强制结束 CLI 进程，最近 1–2 条未保存的对话可能在 CLI 自带 /resume 列表里找不到。
            </span>
          </div>
          <label className="inline-flex items-center gap-2 text-sm mb-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving}
              checked={hibernation.enabled}
              onChange={(e) =>
                setHibernation((h) => ({ ...h, enabled: e.target.checked }))
              }
            />
            <span>启用自动冬眠</span>
          </label>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-muted">空闲多久后冬眠（分钟，5–180）</label>
            <input
              type="number"
              min={5}
              max={180}
              step={1}
              disabled={loading || saving || !hibernation.enabled}
              value={hibernation.idleMinutes}
              onChange={(e) => {
                const n = Math.max(5, Math.min(180, Number(e.target.value) || 15))
                setHibernation((h) => ({ ...h, idleMinutes: n }))
              }}
              className="w-20 px-2 py-1 bg-white/[0.04] border border-border rounded text-sm focus:border-accent focus:bg-white/[0.06] disabled:opacity-60"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving || !hibernation.enabled}
              checked={hibernation.includeShells}
              onChange={(e) =>
                setHibernation((h) => ({ ...h, includeShells: e.target.checked }))
              }
            />
            <span>同时冬眠纯 shell（cmd / pwsh / bash），不推荐 — 会丢 cd 历史</span>
          </label>
        </section>
        )}

        {activeTab === 'terminal' && (
        <section className="mb-4 border-t border-border/40 pt-4">
          <div className="text-sm text-fg/90 mb-1">终端快捷键</div>
          <div className="text-xs text-muted mb-3 leading-relaxed">
            给"中止"动作录一个你设备上好按的备用键。默认 Esc / Ctrl+C
            始终有效，备用键只是多一条路（解决某些设备 Esc 被系统占用按不出的情况）。
            建议用 F1–F12 或带 Ctrl/Alt 的组合键。
          </div>
          {(
            [
              {
                target: 'abortAltKey' as RecordTarget,
                title: '打断 AI 输出',
                defaultLabel: 'Esc',
              },
              {
                target: 'interruptAltKey' as RecordTarget,
                title: '强制中断命令',
                defaultLabel: 'Ctrl+C',
              },
            ]
          ).map((row) => (
            <div
              key={row.target}
              className="flex items-center justify-between gap-2 mb-2"
            >
              <div className="min-w-0">
                <div className="text-sm">{row.title}</div>
                <div className="text-xs text-muted">
                  默认 {row.defaultLabel}（始终有效） · 备用键{' '}
                  <span className="text-fg/80">
                    {recording === row.target
                      ? '按下想用的键…（Esc 取消）'
                      : formatCombo(keybindings[row.target])}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => {
                    setKeyError(null)
                    setRecording(row.target)
                  }}
                  className="fluent-btn px-2.5 py-1 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
                >
                  {recording === row.target ? '录制中…' : '录制'}
                </button>
                <button
                  type="button"
                  disabled={loading || saving || !keybindings[row.target]}
                  onClick={() => {
                    setKeyError(null)
                    setKeybindings((kb) => ({ ...kb, [row.target]: null }))
                  }}
                  className="fluent-btn px-2.5 py-1 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-40"
                >
                  清除
                </button>
              </div>
            </div>
          ))}
          {keyError && (
            <div className="mt-1 text-xs text-amber-300/90">{keyError}</div>
          )}
        </section>
        )}

        {activeTab === 'general' && (
        <section className="mb-4 border-t border-border/40 pt-4">
          <div className="text-sm text-fg/90 mb-1">桌面通知</div>
          <div className="text-xs text-muted mb-2 leading-relaxed">
            AI 会话等待你输入、而浏览器标签页不在前台时，会弹一条系统桌面通知提醒你。
            需要先授权浏览器通知权限；授权一次后长期有效。
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs px-2 py-1 rounded border ${notifyTone}`}>
              🔔 {notifyLabel}
            </span>
            <button
              type="button"
              onClick={() => void onRequestNotify()}
              disabled={
                requestingNotify ||
                notifyPerm === 'granted' ||
                notifyPerm === 'denied' ||
                notifyPerm === 'unsupported'
              }
              className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
            >
              {requestingNotify
                ? '请求中…'
                : notifyPerm === 'granted'
                  ? '已授权'
                  : '请求授权'}
            </button>
          </div>
        </section>
        )}

        {activeTab === 'feishu' && (
        <section className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm text-fg/90">飞书机器人</div>
            {feishuStatus && (
              <span
                className={`text-xs px-2 py-0.5 rounded border ${
                  feishuStatus.state === 'connected'
                    ? 'text-emerald-300 border-emerald-600/40 bg-emerald-500/10'
                    : feishuStatus.state === 'failed'
                      ? 'text-rose-300 border-rose-600/40 bg-rose-500/10'
                      : feishuStatus.running
                        ? 'text-amber-300 border-amber-600/40 bg-amber-500/10'
                        : 'text-muted border-border'
                }`}
              >
                {feishuStatus.state === 'connected'
                  ? '● 在线'
                  : feishuStatus.state === 'failed'
                    ? '● 连接失败'
                    : feishuStatus.state === 'connecting'
                      ? '● 连接中'
                      : feishuStatus.state === 'reconnecting'
                        ? '● 重连中'
                        : '○ 未连接'}
              </span>
            )}
          </div>
          <div className="text-xs text-muted mb-3 leading-relaxed">
            在飞书里跟「总控台 AI」对话，由它替你调度其它 AI 终端干活。
            <span className="text-amber-300/80">
              {' '}
              安全提示：能在飞书指挥 = 能在你电脑上跑命令，所以只有下面白名单里的
              飞书账号 / 群能用，名单为空 = 谁都不行。
            </span>
          </div>

          <label className="inline-flex items-center gap-2 text-sm mb-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={feishuSaving}
              checked={feishuEnabled}
              onChange={(e) => setFeishuEnabled(e.target.checked)}
            />
            <span>启用飞书桥</span>
          </label>

          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted">App ID</label>
              <input
                type="text"
                disabled={feishuSaving}
                value={feishuAppId}
                onChange={(e) => setFeishuAppId(e.target.value)}
                placeholder="cli_xxxxxxxxxxxx"
                className="w-full px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-xs text-muted">
                App Secret
                {feishuHasSecret && (
                  <span className="text-emerald-300/80">
                    {' '}
                    · 已保存（{feishuSecretMask}），留空不修改
                  </span>
                )}
              </label>
              <input
                type="password"
                disabled={feishuSaving}
                value={feishuSecretInput}
                onChange={(e) => setFeishuSecretInput(e.target.value)}
                placeholder={feishuHasSecret ? '留空保留已存密钥' : '输入 App Secret'}
                className="w-full px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-xs text-muted">服务区</label>
              <select
                disabled={feishuSaving}
                value={feishuDomain}
                onChange={(e) =>
                  setFeishuDomain(e.target.value === 'lark' ? 'lark' : 'feishu')
                }
                className="w-full px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60"
              >
                <option value="feishu">飞书（中国大陆）</option>
                <option value="lark">Lark（海外）</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted">
                你的 open_id（总控台主动发消息 / 任务提醒发给谁）
              </label>
              <input
                type="text"
                disabled={feishuSaving}
                value={feishuOwnerOpenId}
                onChange={(e) => setFeishuOwnerOpenId(e.target.value)}
                placeholder="ou_xxxxxxxx"
                className="w-full px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-xs text-muted">
                私聊白名单 open_id（每行一个，空 = 全拒）
              </label>
              <textarea
                disabled={feishuSaving}
                value={feishuAllowOpenIds}
                onChange={(e) => setFeishuAllowOpenIds(e.target.value)}
                rows={2}
                placeholder={'ou_aaa\nou_bbb'}
                className="w-full px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60 font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted">
                群白名单 chat_id（每行一个）
              </label>
              <textarea
                disabled={feishuSaving}
                value={feishuAllowChatIds}
                onChange={(e) => setFeishuAllowChatIds(e.target.value)}
                rows={2}
                placeholder={'oc_xxxx'}
                className="w-full px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60 font-mono text-xs"
              />
            </div>
          </div>

          {feishuTestResult && (
            <div
              className={`mt-2 px-3 py-1.5 text-xs rounded-md border ${
                feishuTestResult.ok
                  ? 'text-emerald-200 bg-emerald-500/15 border-emerald-500/40'
                  : 'text-rose-200 bg-rose-500/15 border-rose-500/40'
              }`}
            >
              {feishuTestResult.ok ? '✓ ' : '✗ '}
              {feishuTestResult.message}
            </div>
          )}
          {feishuError && (
            <div className="mt-2 px-3 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
              {feishuError}
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              disabled={feishuTesting || feishuSaving}
              onClick={() => void onTestFeishu()}
              className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
            >
              {feishuTesting ? '测试中…' : '测试连接'}
            </button>
            <button
              type="button"
              disabled={feishuSaving}
              onClick={() => void onSaveFeishu()}
              className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-accent/60 bg-accent text-on-accent font-medium hover:bg-accent-2 disabled:opacity-60"
            >
              {feishuSaving ? '保存中…' : '保存飞书配置'}
            </button>
          </div>
        </section>
        )}
          </div>

          {/* 底部：取消 / 保存（跨页签共用，存的是通用 + 终端两个页签的设置） */}
          <div className="border-t border-border/40 px-5 py-4">
            {error && (
              <div className="mb-3 px-3 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpenState(false)}
                className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={loading || saving}
                onClick={() => void onSave()}
                className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-accent/60 bg-accent text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] font-medium hover:bg-accent-2 disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
