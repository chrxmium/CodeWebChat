export type JsonRpcId = number | string

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type JsonRpcHandler = (params: any) => Promise<unknown> | unknown

/**
 * Minimal JSON-RPC 2.0 peer over a newline-delimited stream. Used instead of a
 * heavier framework so the Kotlin side can speak it with three lines of code.
 */
export class JsonRpcPeer {
  private next_id = 1
  private pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private handlers = new Map<string, JsonRpcHandler>()

  on_notification?: (method: string, params: any) => void

  constructor(private readonly send_line: (line: string) => void) {}

  register(method: string, handler: JsonRpcHandler): void {
    this.handlers.set(method, handler)
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.next_id++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.send_line(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  notify(method: string, params?: unknown): void {
    this.send_line(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  handle_line(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let message: any
    try {
      message = JSON.parse(trimmed)
    } catch {
      return
    }

    if (message?.method && message.id === undefined) {
      this.on_notification?.(message.method, message.params)
      return
    }

    if (message?.method && message.id !== undefined) {
      void this.handle_request(message)
      return
    }

    if (message?.id !== undefined && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)!
      this.pending.delete(message.id)

      if (message.error) {
        entry.reject(
          new Error(message.error.message ?? 'JSON-RPC request failed')
        )
      } else {
        entry.resolve(message.result)
      }
    }
  }

  private async handle_request(message: {
    id: JsonRpcId
    method: string
    params?: any
  }): Promise<void> {
    const handler = this.handlers.get(message.method)

    if (!handler) {
      this.send_line(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Unknown method: ${message.method}` }
        })
      )
      return
    }

    try {
      const result = await handler(message.params)
      this.send_line(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    } catch (error) {
      this.send_line(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: (error as Error).message }
        })
      )
    }
  }
}
