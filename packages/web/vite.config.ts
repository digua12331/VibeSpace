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
})
