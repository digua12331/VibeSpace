import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki'
import { readCssQuotedString } from './theme/store'

type H = HighlighterGeneric<BundledLanguage, BundledTheme>

/* ---------------------------------------------------------------------------
 * shiki theme 跟随当前 UI 主题：theme name 来自 `--shiki-theme-name` CSS 变量。
 * 创建 highlighter 时一次性加载三套预设主题，切主题时 codeToHtml 直接换 theme
 * 参数即可（无需重建 highlighter）。
 *
 * 用 React 端订阅 theme 变更触发 re-highlight：在调 highlightToHtml 的组件里把
 * useShikiVersion()（在 theme/store.ts）加进 deps 即可。
 * ------------------------------------------------------------------------- */

const PRELOADED_THEMES: BundledTheme[] = [
  'github-dark-dimmed',  // soft-dark 默认
  'github-light',        // light-soft
  'github-dark',         // glass-dark
]
const FALLBACK_THEME: BundledTheme = 'github-dark-dimmed'

const INITIAL_LANGS: BundledLanguage[] = [
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'bash', 'shell', 'yaml',
]

let highlighterPromise: Promise<H> | null = null
const loadingLangs = new Map<string, Promise<void>>()

async function getHighlighter(): Promise<H> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: PRELOADED_THEMES, langs: INITIAL_LANGS }),
    )
  }
  return highlighterPromise
}

function currentTheme(): BundledTheme {
  const v = readCssQuotedString('--shiki-theme-name', FALLBACK_THEME) as BundledTheme
  return PRELOADED_THEMES.includes(v) ? v : FALLBACK_THEME
}

function normaliseLang(lang?: string | null): BundledLanguage | 'text' {
  if (!lang) return 'text'
  const v = lang.toLowerCase()
  if (v === 'plaintext' || v === 'text' || v === 'txt') return 'text'
  // `shell` and `bash` are both valid shiki ids.
  return v as BundledLanguage
}

async function ensureLang(lang: BundledLanguage | 'text'): Promise<void> {
  if (lang === 'text') return
  const h = await getHighlighter()
  if (h.getLoadedLanguages().includes(lang)) return
  let p = loadingLangs.get(lang)
  if (!p) {
    p = h.loadLanguage(lang).catch(() => {
      // Grammar not in the bundle — fall back silently.
    })
    loadingLangs.set(lang, p)
  }
  await p
}

/**
 * Highlight `code` to HTML. Theme is read from the current `--shiki-theme-name`
 * CSS variable on each call, so切主题后下次调用自动用新主题；上层组件需要在
 * deps 里包含 `useShikiVersion()` 触发 re-render 才能"立刻"看到效果。
 *
 * Safe to call before grammars finish loading: unloaded langs produce a
 * plaintext `<pre><code>` that's still escape-safe.
 */
export async function highlightToHtml(code: string, lang?: string | null): Promise<string> {
  const normalised = normaliseLang(lang)
  const h = await getHighlighter()
  await ensureLang(normalised)
  const finalLang = h.getLoadedLanguages().includes(normalised as BundledLanguage)
    ? (normalised as BundledLanguage)
    : 'text'
  return h.codeToHtml(code, { lang: finalLang, theme: currentTheme() })
}

/** Expose the current theme id for components that want to match background colors. */
export function getShikiTheme(): BundledTheme {
  return currentTheme()
}
