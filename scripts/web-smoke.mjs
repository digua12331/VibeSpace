#!/usr/bin/env node
// Verify Vite dev server is up and serving the React entry HTML.
const URL = process.env.AIMON_WEB_URL ?? 'http://127.0.0.1:8788/'

const start = Date.now()
const deadline = start + 30_000
let lastErr = null

while (Date.now() < deadline) {
  try {
    const res = await fetch(URL, { headers: { accept: 'text/html' } })
    const text = await res.text()
    if (res.status !== 200) {
      lastErr = new Error(`HTTP ${res.status}`)
    } else if (!text.includes('<div id="root">')) {
      lastErr = new Error('HTML missing <div id="root">')
    } else if (!text.includes('/src/main.tsx')) {
      lastErr = new Error('HTML missing /src/main.tsx script tag')
    } else {
      console.log('OK', URL, 'status', res.status, 'bytes', text.length)
      console.log('contains root div:', text.includes('<div id="root">'))
      console.log('contains main.tsx:', text.includes('/src/main.tsx'))
      console.log('time-to-ready ms:', Date.now() - start)
      process.exit(0)
    }
  } catch (e) {
    lastErr = e
  }
  await new Promise((r) => setTimeout(r, 500))
}

console.error('FAIL', URL, 'last error:', lastErr?.message ?? lastErr)
process.exit(1)
