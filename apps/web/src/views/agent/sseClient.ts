// Lightweight SSE client using fetch + ReadableStream so we can send Bearer auth headers.
// Reconnects on transient errors (3s backoff) unless the server sent `event: close` or task is terminal.

export type SSEHandler = (event: string, data: any) => void

export interface SSEConnection {
  close: () => void
}

export function openTaskStream(taskId: string, token: string, onEvent: SSEHandler): SSEConnection {
  let aborter: AbortController | null = null
  let closed = false
  let reconnectTimer: any = null

  const connect = async () => {
    if (closed) return
    aborter = new AbortController()
    try {
      const res = await fetch(`/api/review/tasks/${taskId}/stream`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: aborter.signal,
      })
      if (!res.ok || !res.body) throw new Error('stream http ' + res.status)

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buf = ''

      while (!closed) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const rawBlock = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          if (!rawBlock.trim()) continue
          if (rawBlock.startsWith(':')) continue // heartbeat comment

          let eventName = 'message'
          const dataLines: string[] = []
          for (const line of rawBlock.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          const dataStr = dataLines.join('\n')
          let parsed: any = dataStr
          if (dataStr) {
            try {
              parsed = JSON.parse(dataStr)
            } catch {
              parsed = dataStr
            }
          }
          if (eventName === 'close') {
            closed = true
            onEvent(eventName, parsed)
            return
          }
          onEvent(eventName, parsed)
        }
      }
    } catch (e) {
      if (closed) return
      // transient: backoff and retry
      reconnectTimer = setTimeout(connect, 3000)
    }
  }

  connect()

  return {
    close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try {
        aborter?.abort()
      } catch {}
    },
  }
}
