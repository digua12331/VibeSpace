/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Windows 11 Fluent Design — dark theme palette.
        // bg = Mica base (app body). card = layered chrome (header/sidebar/dialogs).
        // Values picked to match WinUI Dark "Solid Background Base" tokens.
        bg: '#202020',
        card: '#2b2b2b',
        'card-2': '#323232',
        border: '#3a3a3a',
        'border-soft': '#323232',
        fg: '#ffffff',
        muted: '#c7c7c7',
        subtle: '#8a8a8a',
        // Fluent accent (Windows 11 dark default).
        accent: '#60cdff',
        'accent-2': '#4cc2ff',
        'accent-deep': '#0078d4',
      },
      borderRadius: {
        // Win11 uses 8px for cards, 4px for buttons/chips.
        win: '8px',
      },
      boxShadow: {
        // Fluent elevation: layered, soft, slightly cool.
        flyout:
          '0 8px 16px rgba(0, 0, 0, 0.14), 0 0 1px rgba(0, 0, 0, 0.28)',
        dialog:
          '0 32px 64px rgba(0, 0, 0, 0.36), 0 0 8px rgba(0, 0, 0, 0.28)',
        tile:
          '0 2px 4px rgba(0, 0, 0, 0.14), 0 0 1px rgba(0, 0, 0, 0.28)',
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
        // Win11 system stack — Segoe UI Variable first, then fallbacks.
        sans: [
          '"Segoe UI Variable Text"',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'system-ui',
          '-apple-system',
          'ui-sans-serif',
          'Roboto',
          'sans-serif',
        ],
        display: [
          '"Segoe UI Variable Display"',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"Cascadia Mono"', '"Cascadia Code"', 'Consolas', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
