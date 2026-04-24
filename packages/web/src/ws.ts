import { backendBase } from './api'
import type { ClientMsg, LogLevel, ServerMsg, WSConnState } from './types'

const RECONNECT_DELAYS = [1000, 2000, 5000]

function wsUrl(): string {
  const httpBase = backendBase()
  return httpBase.replace(/^http/, 'ws') + '/ws'
}

class AimonWS {
  private ws: WebSocket | null = null
  private state: WSConnState = 'closed'
  private subscribed = new Set<string>()
  private msgListeners = new Set<(msg: ServerMsg) => void>()
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
