import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as os from 'os'
import * as path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import {
  ApplyResponseMessage,
  ConnectedBrowser,
  InitializeChatMessage
} from '@shared/types/websocket-message'
import { DEFAULT_PORT, CLIENT_TYPE } from '@shared/constants/websocket'

const CHROME_EXTENSION_ID = 'ljookipcanaglfaocjbgdicfbdhhjffp'

export const get_or_create_shared_token = (): string => {
  const token_dir = path.join(os.homedir(), '.cwc')
  const token_path = path.join(token_dir, '.websocket-token')

  if (fs.existsSync(token_path)) {
    return fs.readFileSync(token_path, 'utf8').trim()
  }

  const token = crypto.randomBytes(32).toString('hex')
  if (!fs.existsSync(token_dir)) {
    fs.mkdirSync(token_dir, { recursive: true, mode: 0o700 })
  }
  fs.writeFileSync(token_path, token, { mode: 0o600 })
  return token
}

type EditorClient = {
  ws: WebSocket
  client_id: string
  is_alive: boolean
}

type BrowserClient = ConnectedBrowser & { ws: WebSocket; is_alive: boolean }

export type ConnectorServerOptions = {
  port?: number
  /** Called when the browser's Apply button copies a response. */
  on_apply_response: (message: ApplyResponseMessage) => void
  on_browsers_changed: (browsers: ConnectedBrowser[]) => void
}

/**
 * Same handshake, authentication and routing as the VS Code extension's
 * `websocket-server-process.ts`, so the unmodified Connector (Chrome MV3 and
 * Firefox MV2) keeps working. The plugin is the "editor": it never connects as a
 * WebSocket client, it speaks JSON-RPC with this process instead.
 */
export class ConnectorServer {
  private vscode_clients = new Map<string, EditorClient>()
  private browser_clients = new Map<string, BrowserClient>()
  private connections = new Set<WebSocket>()
  private http_server: http.Server
  private wss: WebSocketServer
  private ping_timer: NodeJS.Timeout | null = null

  readonly editor_client_id = `jetbrains-${crypto.randomUUID()}`

  constructor(private readonly options: ConnectorServerOptions) {
    this.http_server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost')
      if (url.pathname === '/health') {
        const challenge = url.searchParams.get('challenge')
        const token = get_or_create_shared_token()
        const body: Record<string, string> = { status: 'ok' }

        if (challenge) {
          body.signature = crypto
            .createHmac('sha256', token)
            .update(challenge)
            .digest('hex')
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
        return
      }

      res.writeHead(404)
      res.end()
    })

    this.wss = new WebSocketServer({
      server: this.http_server,
      maxPayload: 10 * 1024 * 1024,
      verifyClient: (info: any, cb: any) => this.verify_client(info, cb)
    })

    this.wss.on('connection', (ws: WebSocket, request: any) =>
      this.handle_connection(ws, request)
    )
  }

  private verify_client(info: any, cb: any): void {
    const url = new URL(info.req.url ?? '', 'http://localhost')
    const client_type = url.searchParams.get('client_type')

    if (client_type === CLIENT_TYPE.BROWSER) {
      const origin: string | undefined = info.req.headers.origin

      if (origin === `chrome-extension://${CHROME_EXTENSION_ID}`)
        return cb(true)

      const dev_id = process.env.DEV_CHROME_EXTENSION_ID
      if (dev_id && origin === `chrome-extension://${dev_id}`) return cb(true)

      // Firefox gives extensions random origins, so an exact match is impossible.
      if (origin && origin.startsWith('moz-extension://')) return cb(true)

      return cb(false, 403, 'Forbidden: Invalid Origin')
    }

    if (client_type === CLIENT_TYPE.EDITOR) {
      const header: string | undefined = info.req.headers.authorization
      const provided = header?.startsWith('Bearer ')
        ? header.substring(7)
        : null

      if (provided && provided === get_or_create_shared_token()) return cb(true)
      return cb(false, 401, 'Unauthorized: Invalid token')
    }

    cb(false, 400, 'Bad Request')
  }

  private handle_connection(ws: WebSocket, request: any): void {
    const url = new URL(request.url ?? '', 'http://localhost')
    const client_type = url.searchParams.get('client_type')

    if (
      client_type !== CLIENT_TYPE.BROWSER &&
      client_type !== CLIENT_TYPE.EDITOR
    ) {
      ws.close(1008, 'Invalid client type')
      return
    }

    const is_browser = client_type === CLIENT_TYPE.BROWSER

    if (is_browser) {
      const id = url.searchParams.get('browser_id') || crypto.randomUUID()
      this.browser_clients.set(id, {
        id,
        version: url.searchParams.get('version') || 'unknown',
        user_agent: url.searchParams.get('user_agent') || 'unknown',
        profile_name: url.searchParams.get('profile_name') || undefined,
        ws,
        is_alive: true
      })
      this.notify_browsers_changed()
      ws.send(JSON.stringify({ action: 'connected', id }))
    } else {
      const client_id = crypto.randomUUID()
      this.vscode_clients.set(client_id, { ws, client_id, is_alive: true })
      ws.send(JSON.stringify({ action: 'client-id-assignment', client_id }))
      ws.send(
        JSON.stringify({
          action: 'browser-connection-status',
          connected_browsers: this.get_browsers()
        })
      )
      for (const browser of this.browser_clients.values()) {
        browser.ws.send(
          JSON.stringify({ action: 'vscode-client-connected', client_id })
        )
      }
    }

    this.connections.add(ws)
    ws.on('error', () => {})
    ws.on('message', (data) => this.handle_message(data.toString(), ws))
    ws.on('close', () => this.handle_disconnection(ws, is_browser, url))
  }

  private handle_message(raw: string, ws: WebSocket): void {
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return

    if (message.action === 'pong') {
      this.mark_alive(ws)
      return
    }

    if (message.action === 'initialize-chat') {
      const target = message.target_browser_id
        ? this.browser_clients.get(message.target_browser_id)
        : Array.from(this.browser_clients.values()).pop()

      if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(raw)
      }
      return
    }

    if (message.action === 'apply-response') {
      this.options.on_apply_response(message as ApplyResponseMessage)

      const editor = this.vscode_clients.get(message.client_id)
      if (editor && editor.ws.readyState === WebSocket.OPEN) {
        editor.ws.send(raw)
      }
      return
    }

    if (message.action === 'forwarded-ports') {
      for (const browser of this.browser_clients.values()) {
        browser.ws.send(raw)
      }
    }
  }

  private mark_alive(ws: WebSocket): void {
    for (const client of this.browser_clients.values()) {
      if (client.ws === ws) {
        client.is_alive = true
        return
      }
    }
    for (const client of this.vscode_clients.values()) {
      if (client.ws === ws) {
        client.is_alive = true
        return
      }
    }
  }

  private handle_disconnection(
    ws: WebSocket,
    is_browser: boolean,
    _url: URL
  ): void {
    if (is_browser) {
      for (const [id, client] of this.browser_clients.entries()) {
        if (client.ws === ws) {
          this.browser_clients.delete(id)
          break
        }
      }
      this.notify_browsers_changed()
    } else {
      for (const [id, client] of this.vscode_clients.entries()) {
        if (client.ws === ws) {
          this.vscode_clients.delete(id)
          break
        }
      }
    }
    this.connections.delete(ws)
  }

  get_browsers(): ConnectedBrowser[] {
    return Array.from(this.browser_clients.values()).map((client) => ({
      id: client.id,
      version: client.version,
      user_agent: client.user_agent,
      profile_name: client.profile_name
    }))
  }

  private notify_browsers_changed(): void {
    this.options.on_browsers_changed(this.get_browsers())
  }

  send_initialize_chat(message: Omit<InitializeChatMessage, 'client_id'>): {
    sent: boolean
    browser?: ConnectedBrowser
  } {
    const target = message.target_browser_id
      ? this.browser_clients.get(message.target_browser_id)
      : Array.from(this.browser_clients.values()).pop()

    if (!target || target.ws.readyState !== WebSocket.OPEN) {
      return { sent: false }
    }

    const payload: InitializeChatMessage = {
      ...message,
      client_id: this.editor_client_id
    }

    target.ws.send(JSON.stringify(payload))

    return {
      sent: true,
      browser: {
        id: target.id,
        version: target.version,
        user_agent: target.user_agent,
        profile_name: target.profile_name
      }
    }
  }

  start(port = this.options.port ?? DEFAULT_PORT): Promise<number> {
    return new Promise((resolve, reject) => {
      const on_error = (error: NodeJS.ErrnoException) => {
        this.http_server.off('listening', on_listening)
        reject(error)
      }
      const on_listening = () => {
        this.http_server.off('error', on_error)
        this.ping_timer = setInterval(() => this.ping_clients(), 10_000)
        const address = this.http_server.address()
        resolve(typeof address === 'object' && address ? address.port : port)
      }

      this.http_server.once('error', on_error)
      this.http_server.once('listening', on_listening)
      this.http_server.listen(port, '127.0.0.1')
    })
  }

  private ping_clients(): void {
    const ping = JSON.stringify({ action: 'ping' })

    for (const client of this.browser_clients.values()) {
      if (!client.is_alive) {
        client.ws.terminate()
        continue
      }
      client.is_alive = false
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(ping)
    }
    for (const client of this.vscode_clients.values()) {
      if (!client.is_alive) {
        client.ws.terminate()
        continue
      }
      client.is_alive = false
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(ping)
    }
  }

  async stop(): Promise<void> {
    if (this.ping_timer) clearInterval(this.ping_timer)
    for (const ws of this.connections) {
      try {
        ws.close(1001, 'Server is shutting down')
      } catch {}
    }
    this.wss.close()
    await new Promise<void>((resolve) =>
      this.http_server.close(() => resolve())
    )
  }
}
