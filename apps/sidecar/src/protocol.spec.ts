import { WebSocket } from 'ws'
import { ConnectorServer, get_or_create_shared_token } from './websocket-server'

const CHROME_ORIGIN = 'chrome-extension://ljookipcanaglfaocjbgdicfbdhhjffp'

type Client = {
  ws: WebSocket
  wait_for: (action: string, timeout?: number) => Promise<any>
}

const connect = (
  port: number,
  params: {
    client_type: 'browser' | 'editor'
    origin?: string
    token?: string
    extra?: string
  }
): Promise<Client> =>
  new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${port}?client_type=${params.client_type}${
      params.extra ?? ''
    }`
    const ws = new WebSocket(url, {
      origin: params.origin,
      headers: params.token ? { Authorization: `Bearer ${params.token}` } : {}
    })

    const queue: any[] = []
    const waiters: {
      action: string
      resolve: (message: any) => void
      timeout: NodeJS.Timeout
    }[] = []

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      const index = waiters.findIndex((w) => w.action === message.action)

      if (index !== -1) {
        const waiter = waiters.splice(index, 1)[0]
        clearTimeout(waiter.timeout)
        waiter.resolve(message)
      } else {
        queue.push(message)
      }
    })

    ws.on('open', () =>
      resolve({
        ws,
        wait_for: (action: string, timeout = 3000) => {
          const queued = queue.findIndex((m) => m.action === action)
          if (queued !== -1) {
            return Promise.resolve(queue.splice(queued, 1)[0])
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(
              () => rej(new Error(`Timed out waiting for ${action}`)),
              timeout
            )
            waiters.push({ action, resolve: res, timeout: timer })
          })
        }
      })
    )
    ws.on('unexpected-response', (_req, res) =>
      reject(new Error(`HTTP ${res.statusCode}`))
    )
    ws.on('error', (error) => reject(error))
  })

describe('ConnectorServer', () => {
  let server: ConnectorServer
  let port: number
  const applied: any[] = []

  beforeEach(async () => {
    applied.length = 0
    server = new ConnectorServer({
      on_apply_response: (message) => applied.push(message),
      on_browsers_changed: () => {}
    })
    port = await server.start(0)
  })

  afterEach(async () => {
    await server.stop()
  })

  it('accepts the Chrome extension origin', async () => {
    const client = await connect(port, {
      client_type: 'browser',
      origin: CHROME_ORIGIN
    })
    const connected = await client.wait_for('connected')
    expect(connected.id).toBeTruthy()
    client.ws.close()
  })

  it('accepts Firefox moz-extension origins', async () => {
    const client = await connect(port, {
      client_type: 'browser',
      origin: 'moz-extension://0e1d2c3b-4a5f-6789-abcd-ef0123456789'
    })
    await client.wait_for('connected')
    expect(server.get_browsers()).toHaveLength(1)
    client.ws.close()
  })

  it('rejects unknown browser origins', async () => {
    await expect(
      connect(port, {
        client_type: 'browser',
        origin: 'https://evil.example'
      })
    ).rejects.toThrow('HTTP 403')
  })

  it('rejects editor connections without the shared token', async () => {
    await expect(connect(port, { client_type: 'editor' })).rejects.toThrow(
      'HTTP 401'
    )
  })

  it('accepts editor connections with the shared token', async () => {
    const client = await connect(port, {
      client_type: 'editor',
      token: get_or_create_shared_token()
    })
    const assignment = await client.wait_for('client-id-assignment')
    expect(assignment.client_id).toBeTruthy()
    client.ws.close()
  })

  it('delivers initialize-chat and routes apply-response back', async () => {
    const client = await connect(port, {
      client_type: 'browser',
      origin: CHROME_ORIGIN
    })
    await client.wait_for('connected')

    const result = server.send_initialize_chat({
      action: 'initialize-chat',
      text: '# Task\n\nHello',
      url: 'https://chatgpt.com/',
      chatbot: 'ChatGPT',
      inject_apply_response_button: true
    })

    expect(result.sent).toBe(true)

    const message = await client.wait_for('initialize-chat')
    expect(message.text).toContain('Hello')
    expect(message.client_id).toBe(server.editor_client_id)

    client.ws.send(
      JSON.stringify({
        action: 'apply-response',
        client_id: server.editor_client_id,
        raw_instructions: 'Hello'
      })
    )

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(applied).toHaveLength(1)
    expect(applied[0].raw_instructions).toBe('Hello')
    client.ws.close()
  })

  it('reports no browser when none is connected', () => {
    const result = server.send_initialize_chat({
      action: 'initialize-chat',
      text: 'x',
      url: 'https://chatgpt.com/',
      chatbot: 'ChatGPT'
    })
    expect(result.sent).toBe(false)
  })
})
