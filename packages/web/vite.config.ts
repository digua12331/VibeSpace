import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const WEB_PORT = Number(process.env.AIMON_WEB_PORT) || 8788

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: WEB_PORT,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // 三组 vendor chunk：按"重量级 + 复用频率"分；不切碎以避免 HTTP 请求过多。
        // 不手拆 react/react-dom——Vite 默认会把它们和 index 入口分到不同 chunk。
        manualChunks(id) {
          if (id.includes('node_modules/@xterm/')) return 'xterm'
          if (
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/remark-gfm') ||
            id.includes('node_modules/rehype-sanitize') ||
            id.includes('node_modules/mdast-util-') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/unist-util-') ||
            id.includes('node_modules/unified') ||
            id.includes('node_modules/hast-util-')
          )
            return 'markdown'
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          return undefined
        },
      },
    },
  },
})
