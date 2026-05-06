/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // borderRadius 全量覆盖（不是 extend）：让所有 rounded-* 跟随 --radius-* 变量。
    // 默认值与 Tailwind 默认 scale 完全一致（在 tokens.css 内），保证升级前后零视觉漂移。
    borderRadius: {
      none: 'var(--radius-none)',
      sm: 'var(--radius-sm)',
      DEFAULT: 'var(--radius)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      '2xl': 'var(--radius-2xl)',
      '3xl': 'var(--radius-3xl)',
      full: 'var(--radius-full)',
      win: 'var(--radius-win)',
    },
    extend: {
      colors: {
        // RGB triplet + <alpha-value> 让 Tailwind opacity 修饰符（bg-bg/50）正常工作。
        // 默认值在 tokens.css :root 内 = 升级前的硬编码 hex。
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        card: 'rgb(var(--color-card) / <alpha-value>)',
        'card-2': 'rgb(var(--color-card-2) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        'border-soft': 'rgb(var(--color-border-soft) / <alpha-value>)',
        fg: 'rgb(var(--color-fg) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-2': 'rgb(var(--color-accent-2) / <alpha-value>)',
        'accent-deep': 'rgb(var(--color-accent-deep) / <alpha-value>)',
        'on-accent': 'rgb(var(--color-on-accent) / <alpha-value>)',
        'code-bg': 'rgb(var(--color-code-bg) / <alpha-value>)',
        'code-fg': 'rgb(var(--color-code-fg) / <alpha-value>)',
      },
      boxShadow: {
        flyout: 'var(--shadow-flyout)',
        dialog: 'var(--shadow-dialog)',
        tile: 'var(--shadow-tile)',
      },
      borderWidth: {
        DEFAULT: 'var(--border-width)',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        blinkFast: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.15' },
        },
        fluentFadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-soft': 'pulseSoft 1.6s ease-in-out infinite',
        'blink-fast': 'blinkFast 0.8s ease-in-out infinite',
        'fluent-in': 'fluentFadeIn 180ms cubic-bezier(0.1, 0.9, 0.2, 1)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}
