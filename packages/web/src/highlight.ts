import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki'

type H = HighlighterGeneric<BundledLanguage, BundledTheme>

const THEME: BundledTheme = 'github-dark-dimmed'

const INITIAL_LANGS: BundledLanguage[] = [
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'bash', 'shell', 'yaml',
]

let highlighterPromise: Promise<H> | null = null
const loadingLangs = new Map<string, Promise<void>>()

async function getHighlighter(): Promise<H> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: [THEME], langs: INITIAL_LANGS }),
    )
  }
  return highlighterPromise
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
 * Highlight `code` to HTML. Safe to call before grammars finish loading:
 * unloaded langs produce a plaintext `<pre><code>` that's still escape-safe.
 */
export async function highlightToHtml(code: string, lang?: string | null): Promise<string> {
  const normalised = normaliseLang(lang)
  const h = await getHighlighter()
  await ensureLang(normalised)
  const finalLang = h.getLoadedLanguages().includes(normalised as BundledLanguage)
    ? (normalised as BundledLanguage)
    : 'text'
  return h.codeToHtml(code, { lang: finalLang, theme: THEME })
}

/** Expose the theme id for components that want to match background colors. */
export const SHIKI_THEME = THEME
