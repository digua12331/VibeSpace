import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  getAppSettings,
  updateAppSettings,
  getFeishuConfig,
  updateFeishuConfig,
  getFeishuStatus,
  testFeishu,
  getWechatConfig,
  updateWechatConfig,
  getWechatStatus,
  wechatLogin,
  wechatBindStart,
  wechatLogout,
  wechatResetBinding,
  getLocalAiProviders,
  getLocalAiModels,
  LS_LOCALAI_PROVIDER,
  LS_LOCALAI_MODEL,
} from '../api'
import { logAction } from '../logs'
import { currentPermission, requestPermission } from '../notify'
import { useStore } from '../store'
import { confirmDialog } from './dialog/DialogHost'
import type {
  AppSettings,
  HibernationSettings,
  KeyCombo,
  ManagerBoundarySettings,
  TerminalKeybindings,
  FeishuStatus,
  FeishuTestResult,
  WechatStatus,
  LocalAiProvider,
  LocalAiProviderId,
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

type SettingsTab = 'general' | 'terminal' | 'manager' | 'feishu' | 'wechat'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'terminal', label: '终端' },
  { id: 'manager', label: '经理 AI 边界' },
  { id: 'feishu', label: '飞书机器人' },
  { id: 'wechat', label: '微信机器人' },
]

const DEFAULT_MANAGER: ManagerBoundarySettings = {
  concurrency: 2,
  confirmGraph: true,
  stopOnFailure: true,
  autoWake: false,
  allowDbChanges: false,
  allowFileDelete: false,
  allowAutoMerge: false,
}

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
  const [maxAiTerminals, setMaxAiTerminalsLocal] = useState<number>(12)
  const [manager, setManager] = useState<ManagerBoundarySettings>(DEFAULT_MANAGER)
  const [requestingNotify, setRequestingNotify] = useState(false)
  const [keybindings, setKeybindings] =
    useState<TerminalKeybindings>(DEFAULT_KEYBINDINGS)
  const [recording, setRecording] = useState<RecordTarget | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  // 本地 AI（提交信息）后端 / 模型选择，存 localStorage（见 api.ts 的 LS_LOCALAI_*）
  const [aiProviders, setAiProviders] = useState<LocalAiProvider[]>([])
  const [aiProvider, setAiProvider] = useState<LocalAiProviderId | ''>('')
  const [aiModels, setAiModels] = useState<string[]>([])
  const [aiModel, setAiModel] = useState('')
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
  // 微信桥（独立加载/操作，走 /api/wechat/*）
  const [wechatEnabled, setWechatEnabled] = useState(false)
  const [wechatOwner, setWechatOwner] = useState('')
  const [wechatHasToken, setWechatHasToken] = useState(false)
  const [wechatStatus, setWechatStatus] = useState<WechatStatus | null>(null)
  const [wechatQrDataUrl, setWechatQrDataUrl] = useState<string | null>(null)
  const [wechatBindCode, setWechatBindCode] = useState<string | null>(null)
  const [wechatBusy, setWechatBusy] = useState(false)
  const [wechatError, setWechatError] = useState<string | null>(null)
  const notifyPerm = useStore((s) => s.notifyPerm)
  const setNotifyPerm = useStore((s) => s.setNotifyPerm)
  const setTerminalKeybindings = useStore((s) => s.setTerminalKeybindings)
  const setMaxAiTerminals = useStore((s) => s.setMaxAiTerminals)

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
        setMaxAiTerminalsLocal(s.maxAiTerminals ?? 12)
        setManager(s.manager ?? DEFAULT_MANAGER)
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
    // 微信配置独立加载（失败不挡其它设置）
    setWechatError(null)
    setWechatQrDataUrl(null)
    setWechatBindCode(null)
    getWechatConfig()
      .then((c) => {
        setWechatEnabled(c.enabled)
        setWechatOwner(c.ownerUserId)
        setWechatHasToken(c.hasToken)
      })
      .catch((e: unknown) =>
        setWechatError(e instanceof Error ? e.message : String(e)),
      )
    getWechatStatus()
      .then(setWechatStatus)
      .catch(() => setWechatStatus(null))
  }, [open, setNotifyPerm])

  // 微信页签打开期间轮询状态（扫码确认、绑定完成都靠它反映到界面）。
  useEffect(() => {
    if (!open || activeTab !== 'wechat') return
    const timer = window.setInterval(() => {
      getWechatStatus()
        .then((s) => {
          setWechatStatus(s)
          // 扫码确认后后端自动转入轮询：收起二维码，刷新已存凭证标记
          if (s.state === 'logged_in') {
            setWechatQrDataUrl(null)
            setWechatHasToken(true)
            setWechatEnabled((prev) => prev || s.configured)
          }
          if (!s.binding.active) setWechatBindCode(null)
          if (s.ownerBound && !wechatOwner) {
            void getWechatConfig().then((c) => setWechatOwner(c.ownerUserId))
          }
        })
        .catch(() => {})
    }, 2500)
    return () => window.clearInterval(timer)
  }, [open, activeTab, wechatOwner])

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

  // 打开设置时拉本地 AI 后端列表，自动选中 已存/首个可达 的后端。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const provs = await getLocalAiProviders()
        if (cancelled) return
        setAiProviders(provs)
        const reachable = provs.filter((p) => p.reachable)
        const stored = localStorage.getItem(
          LS_LOCALAI_PROVIDER,
        ) as LocalAiProviderId | null
        const pick =
          (stored && reachable.some((p) => p.id === stored) ? stored : '') ||
          reachable[0]?.id ||
          ''
        setAiProvider(pick)
      } catch {
        // 后端不可达 → 留空，下拉显示「未检测到本地 AI」
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // 后端变了就重新拉它的模型列表，自动选中 已存/首个。
  useEffect(() => {
    if (!open || !aiProvider) {
      if (!aiProvider) {
        setAiModels([])
        setAiModel('')
      }
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { models } = await getLocalAiModels(aiProvider)
        if (cancelled) return
        setAiModels(models)
        const stored = localStorage.getItem(LS_LOCALAI_MODEL)
        setAiModel((stored && models.includes(stored) ? stored : '') || models[0] || '')
      } catch {
        if (!cancelled) {
          setAiModels([])
          setAiModel('')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, aiProvider])

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
            maxAiTerminals,
            manager,
          }),
        {
          meta: {
            retentionDays: retention,
            hibernation,
            terminalKeybindings: keybindings,
            maxAiTerminals,
            manager,
          },
        },
      )
      // Push the saved bindings into the store so live terminals pick them up
      // immediately without a page reload.
      setTerminalKeybindings(next.terminalKeybindings ?? keybindings)
      setMaxAiTerminals(next.maxAiTerminals ?? maxAiTerminals)
      setOpenState(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // 危险边界开关：想打开时先弹白话风险确认，取消则保持原值。改动只进本地 state，
  // 点「保存」才落盘——所以取消 + 关掉设置 = 什么都没变。
  async function toggleDanger(
    key: 'allowDbChanges' | 'allowFileDelete' | 'allowAutoMerge',
    label: string,
    consequence: string,
  ) {
    const turningOn = !manager[key]
    if (turningOn) {
      const ok = await confirmDialog(
        `打开「${label}」后，经理 AI 的子任务${consequence}，而且不再逐个停下来问你。一旦放行可能造成无法撤销的损失。确定打开吗？`,
        {
          title: '危险操作确认',
          variant: 'danger',
          confirmLabel: '我知道风险，打开',
          cancelLabel: '取消',
        },
      )
      if (!ok) return
    }
    setManager((m) => ({ ...m, [key]: !m[key] }))
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

  async function onWechatLogin() {
    setWechatBusy(true)
    setWechatError(null)
    try {
      const { loginUrl } = await logAction('wechat', 'login', () => wechatLogin())
      const dataUrl = await QRCode.toDataURL(loginUrl, { width: 220, margin: 1 })
      setWechatQrDataUrl(dataUrl)
      const s = await getWechatStatus().catch(() => null)
      if (s) setWechatStatus(s)
    } catch (e: unknown) {
      setWechatError(e instanceof Error ? e.message : String(e))
    } finally {
      setWechatBusy(false)
    }
  }

  async function onWechatBindStart() {
    setWechatBusy(true)
    setWechatError(null)
    try {
      const r = await logAction('wechat', 'bind-start', () => wechatBindStart())
      setWechatBindCode(r.code)
    } catch (e: unknown) {
      setWechatError(e instanceof Error ? e.message : String(e))
    } finally {
      setWechatBusy(false)
    }
  }

  async function onWechatLogout() {
    const ok = await confirmDialog(
      '会清掉登录凭证并停止收消息（已绑定的本人账号保留）。之后想再用需要重新取码扫码。',
      { title: '退出微信连接', confirmLabel: '退出' },
    )
    if (!ok) return
    setWechatBusy(true)
    setWechatError(null)
    try {
      const c = await logAction('wechat', 'logout', () => wechatLogout())
      setWechatEnabled(c.enabled)
      setWechatHasToken(c.hasToken)
      setWechatQrDataUrl(null)
      setWechatBindCode(null)
      const s = await getWechatStatus().catch(() => null)
      if (s) setWechatStatus(s)
    } catch (e: unknown) {
      setWechatError(e instanceof Error ? e.message : String(e))
    } finally {
      setWechatBusy(false)
    }
  }

  async function onWechatResetBinding() {
    const ok = await confirmDialog(
      '解除当前绑定的微信号，它将立即无法再指挥总控台。之后需要重新「开始绑定」。',
      { title: '重置绑定', confirmLabel: '重置' },
    )
    if (!ok) return
    setWechatBusy(true)
    setWechatError(null)
    try {
      await logAction('wechat', 'reset-binding', () => wechatResetBinding())
      setWechatOwner('')
      setWechatBindCode(null)
    } catch (e: unknown) {
      setWechatError(e instanceof Error ? e.message : String(e))
    } finally {
      setWechatBusy(false)
    }
  }

  async function onWechatToggleEnabled(next: boolean) {
    setWechatBusy(true)
    setWechatError(null)
    try {
      const c = await logAction(
        'wechat',
        'save-config',
        () => updateWechatConfig({ enabled: next }),
        { meta: { enabled: next } },
      )
      setWechatEnabled(c.enabled)
      const s = await getWechatStatus().catch(() => null)
      if (s) setWechatStatus(s)
    } catch (e: unknown) {
      setWechatError(e instanceof Error ? e.message : String(e))
    } finally {
      setWechatBusy(false)
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

        {activeTab === 'manager' && (
        <>
        <section className="mb-4 border-b border-border/40 pb-4">
          <div className="text-sm text-fg/90 mb-1">普通设置</div>
          <div className="text-xs text-muted mb-3 leading-relaxed">
            「项目经理 AI」把一个大目标拆成几张任务卡、分给几个隔离的 AI 并行干。下面这几项随手调，调错了顶多效率差点，不会出事。
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-muted">同时并行（个，1–3）</label>
            <input
              type="number"
              min={1}
              max={3}
              step={1}
              disabled={loading || saving}
              value={manager.concurrency}
              onChange={(e) => {
                const n = Math.max(1, Math.min(3, Math.floor(Number(e.target.value) || 2)))
                setManager((m) => ({ ...m, concurrency: n }))
              }}
              className="w-16 px-2 py-1 bg-white/[0.04] border border-border rounded text-sm focus:border-accent focus:bg-white/[0.06] disabled:opacity-60"
            />
          </div>
          <label className="flex items-start gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving}
              checked={manager.confirmGraph}
              onChange={(e) => setManager((m) => ({ ...m, confirmGraph: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-xs text-fg/90">
              派工前先给我看整张任务图、停下等我点「开始」
              <span className="text-muted">（关掉则经理 AI 拆完直接派，不等你确认）</span>
            </span>
          </label>
          <label className="flex items-start gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving}
              checked={manager.stopOnFailure}
              onChange={(e) => setManager((m) => ({ ...m, stopOnFailure: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-xs text-fg/90">
              有一个任务失败就停下，不再往下派
              <span className="text-muted">（关掉则没出错的分支继续干）</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving}
              checked={manager.autoWake}
              onChange={(e) => setManager((m) => ({ ...m, autoWake: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-xs text-fg/90">
              让经理 AI 定时自己醒来盯进度
              <span className="text-amber-300/80">（实验·默认关：子任务待合并/失败时自动提醒经理处理；仍会停在确认/合并闸口，不替你拍板）</span>
            </span>
          </label>
        </section>
        <section className="mb-4">
          <div className="text-sm text-rose-300 mb-1">危险设置（默认全锁死）</div>
          <div className="text-xs text-muted mb-3 leading-relaxed">
            下面这些默认关着。<span className="text-rose-300/80">就算你不开，后端也会按 AI 实际改了什么自动拦截</span>——比如它真删了文件、真碰了数据库，没开对应开关就不让合并。打开等于把这道保险拆掉。
          </div>
          {([
            ['allowDbChanges', '允许动数据库', '可以改你的数据库（增删改数据、改表结构）'],
            ['allowFileDelete', '允许删文件', '可以删除项目里的文件'],
            ['allowAutoMerge', '允许自动合并代码', '可以不经你点击就把子任务的改动合并进主分支'],
          ] as const).map(([key, label, consequence]) => (
            <div key={key} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-xs text-fg/90">{label}</span>
              <button
                type="button"
                disabled={loading || saving}
                onClick={() => void toggleDanger(key, label, consequence)}
                className={`shrink-0 px-2.5 py-1 rounded text-xs border transition-colors disabled:opacity-60 ${
                  manager[key]
                    ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
                    : 'bg-white/[0.04] text-muted border-border hover:text-fg'
                }`}
              >
                {manager[key] ? '已打开' : '已锁死'}
              </button>
            </div>
          ))}
        </section>
        </>
        )}

        {activeTab === 'terminal' && (
        <section className="mb-4 border-b border-border/40 pb-4">
          <div className="text-sm text-fg/90 mb-1">AI 终端数量上限</div>
          <div className="text-xs text-muted mb-2 leading-relaxed">
            最多能同时开几个 AI 终端页签。只数 AI 终端，文件 / 网页预览这类页签不占名额。
            开太多浏览器会明显变卡，机器好就调大，机器吃力就调小。
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted">上限（个，1–50）</label>
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              disabled={loading || saving}
              value={maxAiTerminals}
              onChange={(e) => {
                const n = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 12)))
                setMaxAiTerminalsLocal(n)
              }}
              className="w-20 px-2 py-1 bg-white/[0.04] border border-border rounded text-sm focus:border-accent focus:bg-white/[0.06] disabled:opacity-60"
            />
          </div>
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

        {activeTab === 'general' && (
        <section className="mb-4 border-t border-border/40 pt-4">
          <div className="text-sm text-fg/90 mb-1">本地 AI（提交信息）</div>
          <div className="text-xs text-muted mb-2 leading-relaxed">
            在「源代码管理」面板点「✨ 生成」时，用这里选的本机模型读当前改动、
            自动写一句提交说明。需要你自己先开着 Ollama 或 LM Studio（本地模型软件），
            全程不联网、改动不出本机。
          </div>
          <div className="flex items-center gap-2">
            <select
              value={aiProvider}
              onChange={(e) => {
                const v = e.target.value as LocalAiProviderId | ''
                setAiProvider(v)
                if (v) localStorage.setItem(LS_LOCALAI_PROVIDER, v)
              }}
              className="flex-1 min-w-0 px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors"
            >
              {aiProviders.length === 0 && <option value="">未检测到本地 AI</option>}
              {aiProviders.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.reachable}>
                  {p.label}
                  {p.reachable ? '' : '（未启动）'}
                </option>
              ))}
            </select>
            <select
              value={aiModel}
              onChange={(e) => {
                setAiModel(e.target.value)
                if (e.target.value) localStorage.setItem(LS_LOCALAI_MODEL, e.target.value)
              }}
              disabled={aiModels.length === 0}
              className="flex-1 min-w-0 px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-50"
            >
              {aiModels.length === 0 && <option value="">无模型</option>}
              {aiModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
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

        {activeTab === 'wechat' && (
        <section className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm text-fg/90">微信机器人</div>
            {wechatStatus && (
              <span
                className={`text-xs px-2 py-0.5 rounded border ${
                  wechatStatus.state === 'logged_in'
                    ? 'text-emerald-300 border-emerald-600/40 bg-emerald-500/10'
                    : wechatStatus.state === 'error'
                      ? 'text-rose-300 border-rose-600/40 bg-rose-500/10'
                      : wechatStatus.state === 'scanning'
                        ? 'text-amber-300 border-amber-600/40 bg-amber-500/10'
                        : 'text-muted border-border'
                }`}
              >
                {wechatStatus.state === 'logged_in'
                  ? '● 已连接'
                  : wechatStatus.state === 'scanning'
                    ? '● 等待扫码'
                    : wechatStatus.state === 'error'
                      ? '● 连接异常'
                      : '○ 未连接'}
              </span>
            )}
          </div>
          <div className="text-xs text-muted mb-3 leading-relaxed">
            用你自己的微信跟「总控台 AI」一问一答（查项目、派任务、问进度）。
            <span className="text-amber-300/80">
              {' '}
              限制：微信只能即时回话，不能主动找你——任务完成提醒仍走飞书。
              收不到回复时，回这里重新取码连接即可。
            </span>
          </div>

          <label className="inline-flex items-center gap-2 text-sm mb-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={wechatBusy}
              checked={wechatEnabled}
              onChange={(e) => void onWechatToggleEnabled(e.target.checked)}
            />
            <span>启用微信桥</span>
          </label>

          {/* 连接区：取码 / 二维码 / 退出 */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={wechatBusy}
                onClick={() => void onWechatLogin()}
                className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-accent/60 bg-accent text-on-accent font-medium hover:bg-accent-2 disabled:opacity-60"
              >
                {wechatBusy ? '处理中…' : wechatHasToken ? '重新取码' : '取码连接'}
              </button>
              {wechatHasToken && (
                <button
                  type="button"
                  disabled={wechatBusy}
                  onClick={() => void onWechatLogout()}
                  className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
                >
                  退出连接
                </button>
              )}
            </div>
            {wechatQrDataUrl && wechatStatus?.state === 'scanning' && (
              <div className="flex flex-col items-center gap-1 p-3 bg-white rounded-md w-[244px]">
                <img src={wechatQrDataUrl} alt="微信登录二维码" width={220} height={220} />
                <div className="text-[11px] text-black/70">
                  用手机微信扫码（约 3 分钟内有效）
                </div>
              </div>
            )}
            {wechatStatus?.state === 'error' && wechatStatus.lastError && (
              <div className="px-3 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
                {wechatStatus.lastError}
              </div>
            )}
          </div>

          {/* 绑定区：只有绑定的本人微信号能指挥总控台 */}
          <div className="space-y-2 mb-3 border-t border-border/40 pt-3">
            <div className="text-xs text-muted">
              绑定本人：
              {wechatOwner ? (
                <span className="text-emerald-300/90"> 已绑定（{wechatOwner.slice(0, 10)}…）</span>
              ) : (
                <span className="text-amber-300/90"> 未绑定——连接后点「开始绑定」，把口令发给机器人</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={wechatBusy || !wechatHasToken}
                onClick={() => void onWechatBindStart()}
                className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
              >
                开始绑定
              </button>
              {wechatOwner && (
                <button
                  type="button"
                  disabled={wechatBusy}
                  onClick={() => void onWechatResetBinding()}
                  className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
                >
                  重置绑定
                </button>
              )}
            </div>
            {wechatBindCode && wechatStatus?.binding.active && (
              <div className="px-3 py-2 text-sm rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200">
                在微信里把口令 <span className="font-mono font-bold text-base">{wechatBindCode}</span>{' '}
                发给机器人完成绑定（2 分钟内有效）
              </div>
            )}
          </div>

          {/* 最近收发时间（发送成功仅代表请求被微信受理，以手机实际收到为准） */}
          {wechatStatus && (wechatStatus.lastInboundAt || wechatStatus.lastOutboundAt) && (
            <div className="text-[11px] text-muted">
              最近收到：{wechatStatus.lastInboundAt ? new Date(wechatStatus.lastInboundAt).toLocaleTimeString() : '—'}
              {' · '}
              最近发出：{wechatStatus.lastOutboundAt ? new Date(wechatStatus.lastOutboundAt).toLocaleTimeString() : '—'}
            </div>
          )}
          {wechatError && (
            <div className="mt-2 px-3 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
              {wechatError}
            </div>
          )}
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
