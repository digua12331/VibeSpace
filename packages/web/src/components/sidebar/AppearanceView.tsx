import { useState } from 'react'
import {
  useThemeStore,
  THEME_NAMES,
  THEME_LABELS,
  type ThemeName,
} from '../../theme/store'

/* ---------------------------------------------------------------------------
 * 外观面板：切预设主题 + 粘贴自定义 CSS。
 *
 * 主理人在面板里可以做的事：
 *   - 三选一切预设（柔和深灰 / 亮色护眼 / 黑色玻璃拟态）
 *   - 粘贴 CSS 覆盖任何 design token（颜色 / 圆角 / 字体 / 阴影 / 玻璃材质）
 *   - 折叠区有变量速查表，复制粘贴即可
 * ------------------------------------------------------------------------- */

const THEME_PREVIEWS: Record<ThemeName, { bg: string; fg: string; accent: string }> = {
  'soft-dark': { bg: '#1f1f23', fg: '#d4d4d6', accent: '#60cdff' },
  'light-soft': { bg: '#f4f4f5', fg: '#2a2a2e', accent: '#0078d4' },
  'glass-dark': { bg: '#08080e', fg: '#e2e2e6', accent: '#8ab4ff' },
}

interface TokenRef {
  name: string
  desc: string
  example?: string
}

const TOKEN_REFERENCE: Array<{ group: string; vars: TokenRef[] }> = [
  {
    group: '颜色（值是 R G B 三个数字，空格分隔）',
    vars: [
      { name: '--color-bg', desc: '主背景', example: '17 34 51' },
      { name: '--color-fg', desc: '主文字色' },
      { name: '--color-card', desc: '卡片底色' },
      { name: '--color-border', desc: '边框色' },
      { name: '--color-accent', desc: '主色（按钮 / 焦点环）' },
      { name: '--color-on-accent', desc: '主色按钮上的文字色' },
      { name: '--color-code-bg', desc: '代码块底色' },
      { name: '--color-code-fg', desc: '代码块文字色' },
      { name: '--color-xterm-bg', desc: '终端背景色' },
      { name: '--color-xterm-fg', desc: '终端文字色' },
    ],
  },
  {
    group: '圆角（CSS 单位，如 0 / 4px / 8px）',
    vars: [
      { name: '--radius-md', desc: '按钮圆角', example: '0' },
      { name: '--radius-lg', desc: '卡片圆角' },
      { name: '--radius-win', desc: 'Fluent 弹窗圆角' },
      { name: '--radius-full', desc: '全圆（头像等）' },
    ],
  },
  {
    group: '字体（CSS font-family 写法）',
    vars: [
      { name: '--font-sans', desc: 'UI 文字字体', example: "'Inter', sans-serif" },
      { name: '--font-mono', desc: '代码 / 终端等宽字体' },
    ],
  },
  {
    group: '阴影（CSS box-shadow 写法）',
    vars: [
      { name: '--shadow-flyout', desc: '弹出菜单阴影' },
      {
        name: '--shadow-dialog',
        desc: '对话框阴影',
        example: '0 40px 80px rgba(0,0,0,0.6)',
      },
    ],
  },
  {
    group: '表面材质（玻璃 vs 实色）',
    vars: [
      {
        name: '--surface-bg',
        desc: '卡片背景（可半透明）',
        example: 'rgb(20 20 30 / 0.55)',
      },
      { name: '--surface-blur', desc: '背景模糊强度', example: '24px' },
      { name: '--surface-saturate', desc: '色彩饱和度', example: '140%' },
    ],
  },
  {
    group: '边框宽度',
    vars: [{ name: '--border-width', desc: '默认边框粗细', example: '2px' }],
  },
  {
    group: '代码高亮主题（shiki 主题名，用引号）',
    vars: [
      {
        name: '--shiki-theme-name',
        desc: '代码块高亮风格',
        example: "'github-light'",
      },
    ],
  },
]

const PLACEHOLDER_CSS = `:root {
  --color-bg: 17 34 51;
  --radius-md: 0;
  --font-sans: 'Inter', sans-serif;
  --surface-blur: 24px;
}`

export default function AppearanceView() {
  const theme = useThemeStore((s) => s.theme)
  const customCss = useThemeStore((s) => s.customCss)
  const setTheme = useThemeStore((s) => s.setTheme)
  const setCustomCss = useThemeStore((s) => s.setCustomCss)
  const resetCustomCss = useThemeStore((s) => s.resetCustomCss)

  const [draft, setDraft] = useState(customCss)
  const [refOpen, setRefOpen] = useState(false)

  const draftDirty = draft !== customCss

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4 text-sm">
      {/* 主题选择 */}
      <section>
        <div className="text-[11px] uppercase tracking-[0.12em] text-subtle font-medium mb-2">
          主题
        </div>
        <div className="space-y-1.5">
          {THEME_NAMES.map((name) => {
            const active = theme === name
            const preview = THEME_PREVIEWS[name]
            return (
              <button
                key={name}
                onClick={() => void setTheme(name)}
                className={`fluent-btn w-full px-3 py-2 rounded-md text-left flex items-center gap-3 border ${
                  active
                    ? 'bg-accent/10 border-accent/40 text-fg'
                    : 'bg-card border-border hover:bg-card-2 text-muted hover:text-fg'
                }`}
              >
                <span
                  className="w-8 h-8 rounded shrink-0 border border-border"
                  style={{
                    background: `linear-gradient(135deg, ${preview.bg} 0%, ${preview.bg} 60%, ${preview.accent} 60%, ${preview.accent} 100%)`,
                  }}
                />
                <span className="flex-1 min-w-0">
                  <div className="font-medium">{THEME_LABELS[name]}</div>
                  <div className="text-[11px] text-subtle truncate">
                    {preview.bg} · {preview.fg}
                  </div>
                </span>
                {active && <span className="text-accent text-xs">●</span>}
              </button>
            )
          })}
        </div>
      </section>

      {/* 自定义 CSS */}
      <section>
        <div className="text-[11px] uppercase tracking-[0.12em] text-subtle font-medium mb-2">
          自定义 CSS
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={PLACEHOLDER_CSS}
          className="w-full px-3 py-2 bg-card-2 border border-border rounded-md focus:border-accent text-xs font-mono leading-relaxed resize-none transition-colors"
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <button
            onClick={() => void setCustomCss(draft)}
            disabled={!draftDirty}
            className="fluent-btn px-3 py-1.5 text-xs rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            应用
          </button>
          <button
            onClick={() => {
              setDraft('')
              void resetCustomCss()
            }}
            disabled={!customCss && !draft}
            className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border bg-card hover:bg-card-2 text-muted hover:text-fg disabled:opacity-50"
          >
            重置
          </button>
          <span className="text-[11px] text-subtle ml-auto">
            没效果？打开浏览器 console 看是否有 CSS 警告
          </span>
        </div>
      </section>

      {/* 变量速查（折叠） */}
      <section>
        <button
          onClick={() => setRefOpen((v) => !v)}
          className="fluent-btn w-full px-3 py-2 rounded-md text-left flex items-center justify-between bg-card border border-border hover:bg-card-2"
        >
          <span className="text-[11px] uppercase tracking-[0.12em] text-subtle font-medium">
            变量速查（{refOpen ? '收起' : '展开'}）
          </span>
          <span className="text-muted text-xs">{refOpen ? '▾' : '▸'}</span>
        </button>
        {refOpen && (
          <div className="mt-2 space-y-3">
            {TOKEN_REFERENCE.map((sec) => (
              <div key={sec.group}>
                <div className="text-xs text-muted mb-1">{sec.group}</div>
                <div className="rounded-md border border-border bg-card-2 divide-y divide-border/40">
                  {sec.vars.map((v) => (
                    <div
                      key={v.name}
                      className="px-3 py-1.5 flex items-baseline gap-2 text-xs"
                    >
                      <code className="font-mono text-accent shrink-0">{v.name}</code>
                      <span className="text-muted flex-1 min-w-0 truncate">{v.desc}</span>
                      {v.example && (
                        <code className="text-[11px] text-subtle font-mono">
                          {v.example}
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
