import { backendBase } from './api'
import type { ClientMsg, LogLevel, ServerMsg, WSConnState } from './types'

const RECONNECT_DELAYS = [1000, 2000, 5000]

function wsUrl(): string {
  const httpBase = backendBase()
  return httpBase.replace(/^http/, 'ws') + '/ws'
}

// ServerMsg 里携带 sessionId 的几种消息类型——SessionView 只关心这几种，
// 给它们走"按 sessionId 路由"通道可以避免 N² fan-out（N 个 SessionView 都注册
// 一个全局 onMessage，每条消息都被 N 个回调看一眼）。
// 其余消息（hello / log / error / error-pattern-alert）继续走全局 onMessage——
// main.tsx 是它们的唯一处理点，整体路由化会让连接状态、日志面板、错误循环
// 提示静默失效。
const SESSION_SCOPED_TYPES: ReadonlySet<ServerMsg['type']> = new Set([
  'output',
  'replay',
  'status',
  'exit',
])

class AimonWS {
  private ws: WebSocket | null = null
  private state: WSConnState = 'closed'
  private subscribed = new Set<string>()
  private msgListeners = new Set<(msg: ServerMsg) => void>()
  // 按 sessionId 分桶的"session-scoped"回调表。每条带 sessionId 的消息从
  // onmessage 进来时，全局 listeners 全调（不变），再 fan-out 给本 sessionId
  // 的回调，避免无关 SessionView 被无效命中。
  private sessionMsgListeners = new Map<string, Set<(msg: ServerMsg) => void>>()
  private connListeners = new Set<(state: WSConnState) => void>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private manualClose = false
  private outbox: ClientMsg[] = []

  connect(): void {
    if (this.ws && (this.state === 'open' || this.state === 'connecting')) return
    this.manualClose = false
    this.openSocket()
  }

  private openSocket(): void {
    this.setState('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.setState('open')
      if (this.subscribed.size > 0) {
        this.rawSend({ type: 'subscribe', sessionIds: [...this.subscribed] })
      }
      const queued = this.outbox
      this.outbox = []
      for (const m of queued) this.rawSend(m)
    }
    ws.onmessage = (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMsg
      } catch {
        return
      }
      for (const cb of this.msgListeners) cb(msg)
      if (SESSION_SCOPED_TYPES.has(msg.type)) {
        const sid = (msg as { sessionId?: string }).sessionId
        if (typeof sid === 'string') {
          const bucket = this.sessionMsgListeners.get(sid)
          if (bucket) {
            for (const cb of bucket) cb(msg)
          }
        }
      }
    }
    ws.onerror = () => {
      // close handler will fire and reconnect
    }
    ws.onclose = () => {
      this.ws = null
      this.setState('closed')
      if (!this.manualClose) this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }

  private setState(s: WSConnState): void {
    if (this.state === s) return
    this.state = s
    for (const cb of this.connListeners) cb(s)
  }

  private rawSend(msg: ClientMsg): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  private send(msg: ClientMsg): void {
    if (!this.rawSend(msg)) this.outbox.push(msg)
  }

  subscribe(ids: string[]): void {
    const fresh = ids.filter((id) => !this.subscribed.has(id))
    for (const id of ids) this.subscribed.add(id)
    if (fresh.length > 0) this.send({ type: 'subscribe', sessionIds: fresh })
  }

  unsubscribe(ids: string[]): void {
    const drop = ids.filter((id) => this.subscribed.has(id))
    for (const id of drop) this.subscribed.delete(id)
    if (drop.length > 0) this.send({ type: 'unsubscribe', sessionIds: drop })
  }

  sendInput(id: string, data: string): void {
    this.send({ type: 'input', sessionId: id, data })
  }

  sendResize(id: string, cols: number, rows: number): void {
    this.send({ type: 'resize', sessionId: id, cols, rows })
  }

  requestReplay(id: string): void {
    this.send({ type: 'replay', sessionId: id })
  }

  /**
   * Fire-and-forget client log → backend for persistence. Dropped silently
   * when the socket isn't open (reconnect will not replay the queue, to
   * avoid a log storm after a long disconnect). Callers should never rely
   * on delivery for correctness.
   */
  sendClientLog(entry: {
    level: LogLevel
    scope: string
    msg: string
    projectId?: string
    sessionId?: string
    meta?: unknown
  }): void {
    this.rawSend({ type: 'log-from-client', ...entry })
  }

  onMessage(cb: (msg: ServerMsg) => void): () => void {
    this.msgListeners.add(cb)
    return () => {
      this.msgListeners.delete(cb)
    }
  }

  /**
   * 订阅"只关心某个 sessionId 的消息"——只接 output/replay/status/exit。
   * 不替代 onMessage：hello/log/error/error-pattern-alert 这类无 sessionId
   * 的消息仍只通过 onMessage 派发（main.tsx 是它们的唯一处理点）。
   * 解决的问题：N 个 SessionView 各注册一个全局 onMessage 时，每条 output
   * 消息会被 N 个回调依次看一眼（N²），同开 6+ 终端时 CPU 显著抖动。
   */
  onSessionMessage(
    sessionId: string,
    cb: (msg: ServerMsg) => void,
  ): () => void {
    let bucket = this.sessionMsgListeners.get(sessionId)
    if (!bucket) {
      bucket = new Set()
      this.sessionMsgListeners.set(sessionId, bucket)
    }
    bucket.add(cb)
    return () => {
      const cur = this.sessionMsgListeners.get(sessionId)
      if (!cur) return
      cur.delete(cb)
      if (cur.size === 0) this.sessionMsgListeners.delete(sessionId)
    }
  }

  onConnectionChange(cb: (state: WSConnState) => void): () => void {
    this.connListeners.add(cb)
    cb(this.state)
    return () => {
      this.connListeners.delete(cb)
    }
  }

  getState(): WSConnState {
    return this.state
  }
}

export const aimonWS = new AimonWS()
