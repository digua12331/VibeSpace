import { create } from 'zustand'
import { logAction, pushLog } from '../logs'

/* ---------------------------------------------------------------------------
 * Theme store — 当前预设主题 + 自定义 CSS。
 *
 * 持久化：localStorage `aimon_theme_v1`，JSON `{ theme, customCss }`。
 * FOUC 防闪：index.html 里有一段同步 inline <script> 在 React 启动前已经
 * 读过 localStorage 设置了 `<html data-theme>` 和注入 `<style id="user-theme">`，
 * 所以 store 初始化时只是 reconcile，不会再触发样式闪烁。
 * ------------------------------------------------------------------------- */

export type ThemeName = 'soft-dark' | 'light-soft' | 'glass-dark'
export const THEME_NAMES: ThemeName[] = ['soft-dark', 'light-soft', 'glass-dark']
export const THEME_LABELS: Record<ThemeName, string> = {
  'soft-dark': '柔和深灰',
  'light-soft': '亮色护眼',
  'glass-dark': '黑色玻璃拟态',
}

const LS_KEY = 'aimon_theme_v1'
const USER_STYLE_ID = 'user-theme'
const MAX_CSS_BYTES = 100 * 1024

interface PersistedState {
  theme: ThemeName
  customCss: string
}

function readPersisted(): PersistedState {
  if (typeof localStorage === 'undefined') return { theme: 'soft-dark', customCss: '' }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { theme: 'soft-dark', customCss: '' }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const theme = (THEME_NAMES.includes(parsed.theme as ThemeName)
      ? parsed.theme
      : 'soft-dark') as ThemeName
    const customCss = typeof parsed.customCss === 'string' ? parsed.customCss : ''
    return { theme, customCss }
  } catch {
    return { theme: 'soft-dark', customCss: '' }
  }
}

function writePersisted(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    /* quota / disabled — 主题状态降级为内存态，刷新后丢 */
  }
}

function applyDataset(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

/**
 * 把用户 CSS 里裸 `:root` 升格成 `:root[data-theme]`，让特异性 (0,1,1) 盖过
 * 预设主题 `[data-theme="..."]` 的 (0,1,0)。否则用户粘贴标准 `:root { --foo }`
 * 永远被预设主题覆盖（apply-css 日志成功但视觉无变化）。
 *
 * 同步副本在 packages/web/index.html 的 FOUC IIFE 兜底脚本里——改这里时也改那里。
 */
export function bumpRootSpecificity(css: string): string {
  if (!css) return css
  return css.replace(/:root\b(?![\[(])/g, ':root[data-theme]')
}

function applyUserCss(css: string): void {
  if (typeof document === 'undefined') return
  let el = document.getElementById(USER_STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = USER_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = bumpRootSpecificity(css)
}

interface ThemeState {
  theme: ThemeName
  customCss: string
  /** Bumped on every theme/css change. shiki 通过 useShikiVersion() 订阅以触发 re-highlight。 */
  shikiVersion: number
  setTheme: (theme: ThemeName) => Promise<void>
  setCustomCss: (css: string) => Promise<void>
  resetCustomCss: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readPersisted()
  // inline script 已经设过 dataset/style，这里再 reconcile 一次保证状态一致
  applyDataset(initial.theme)
  applyUserCss(initial.customCss)

  return {
    theme: initial.theme,
    customCss: initial.customCss,
    shikiVersion: 0,

    setTheme: async (theme: ThemeName) => {
      const prev = get().theme
      if (prev === theme) return
      await logAction(
        'theme',
        'switch',
        async () => {
          applyDataset(theme)
          writePersisted({ theme, customCss: get().customCss })
          set({ theme, shikiVersion: get().shikiVersion + 1 })
        },
        { meta: { from: prev, to: theme } },
      )
    },

    setCustomCss: async (css: string) => {
      const bytes = new Blob([css]).size
      if (bytes > MAX_CSS_BYTES) {
        // 超长：直接 ERROR 日志拒绝；不调 fn、不抛——AppearanceView 不需要 try/catch
        pushLog({
          level: 'error',
          scope: 'theme',
          msg: `apply-css 失败: CSS 长度 ${bytes} 字节超过上限 ${MAX_CSS_BYTES} 字节`,
          meta: { length: bytes, max: MAX_CSS_BYTES },
        })
        return
      }
      await logAction(
        'theme',
        'apply-css',
        async () => {
          applyUserCss(css)
          writePersisted({ theme: get().theme, customCss: css })
          set({ customCss: css, shikiVersion: get().shikiVersion + 1 })
        },
        { meta: { length: bytes } },
      )
    },

    resetCustomCss: async () => {
      const cur = get().customCss
      if (!cur) return
      await logAction('theme', 'reset-css', async () => {
        applyUserCss('')
        writePersisted({ theme: get().theme, customCss: '' })
        set({ customCss: '', shikiVersion: get().shikiVersion + 1 })
      })
    },
  }
})

/* ---------------------------------------------------------------------------
 * Hooks & helpers — 给 xterm / shiki / inline style 这些不吃 CSS 变量的子系统读 token
 * ------------------------------------------------------------------------- */

/** Subscribe to shiki re-highlight trigger (incremented on every theme/css change). */
export function useShikiVersion(): number {
  return useThemeStore((s) => s.shikiVersion)
}

/** Read a CSS variable as raw string (trimmed). */
export function readCssVar(varName: string, fallback = ''): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return v || fallback
}

/** Read a CSS variable holding RGB triplet ("R G B") and return rgb(...) string. */
export function readCssRgb(varName: string, fallback = '0 0 0'): string {
  const v = readCssVar(varName, fallback)
  return `rgb(${v})`
}

/** Read a CSS variable holding a quoted string (e.g. shiki theme name) — strips quotes. */
export function readCssQuotedString(varName: string, fallback = ''): string {
  const v = readCssVar(varName, fallback)
  return v.replace(/^['"]|['"]$/g, '')
}
