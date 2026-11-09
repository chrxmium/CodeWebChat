import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { JsonRpcPeer } from './json-rpc'
import { FsHost } from './hosts/fs-host'
import { register_methods, SidecarState } from './methods'
import type { ConnectorServer } from './websocket-server'

const make_harness = (workspace: string) => {
  const out: any[] = []
  const peer = new JsonRpcPeer((line) => out.push(JSON.parse(line)))
  const host = new FsHost([{ name: path.basename(workspace), path: workspace }])
  const state: SidecarState = { last_states: [], last_strategy: null }
  const sent: any[] = []

  const server = {
    get_browsers: () => [],
    send_initialize_chat: (message: any) => {
      sent.push(message)
      return { sent: true, browser: { id: 'b1' } }
    }
  } as unknown as ConnectorServer

  register_methods({ peer, host, server, state })

  const call = async (id: number, method: string, params?: unknown) => {
    peer.handle_line(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      const found = out.find((m) => m.id === id)
      if (found) return found
    }
    throw new Error(`No response for ${method}`)
  }

  return { call, host, sent, state }
}

describe('sidecar methods', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cwc-sidecar-'))
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'src/app.ts'),
      'export const hello = "world"\n'
    )
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('builds a prompt from the host selection', async () => {
    const { call, host } = make_harness(workspace)
    host.set_selected_files([path.join(workspace, 'src/app.ts')])

    const response = await call(1, 'prompt.build', {
      instructions: 'Rename hello to greeting.',
      prompt_type: 'edit',
      edit_format: 'whole'
    })

    expect(response.error).toBeUndefined()
    expect(response.result.text).toContain('### File: `src/app.ts`')
    expect(response.result.text).toContain('export const hello = "world"')
    expect(response.result.text).toContain('# Task')
    expect(response.result.text).toContain('Rename hello to greeting.')
    expect(response.result.file_count).toBe(1)
  })

  it('fails with an empty context', async () => {
    const { call } = make_harness(workspace)
    const response = await call(1, 'prompt.build', { instructions: 'x' })
    expect(response.error.message).toContain('Context is empty')
  })

  it('initializes a chatbot through the connector', async () => {
    const { call, sent } = make_harness(workspace)

    const response = await call(1, 'chat.initialize', {
      text: '# Task\n\ndo it',
      chatbot: 'Claude',
      model: 'claude-sonnet'
    })

    expect(response.result.sent).toBe(true)
    expect(sent[0].url).toBe('https://claude.ai/new')
    expect(sent[0].inject_apply_response_button).toBe(true)
  })

  it('rejects an unknown chatbot', async () => {
    const { call } = make_harness(workspace)
    const response = await call(1, 'chat.initialize', { chatbot: 'Not A Bot' })
    expect(response.error.message).toContain('Unknown chatbot')
  })

  it('applies a response and reverts it', async () => {
    const { call } = make_harness(workspace)
    const file = path.join(workspace, 'src/app.ts')

    const applied = await call(1, 'response.apply', {
      response: [
        '### Updated file: `src/app.ts`',
        '',
        '```ts',
        'export const hello = "there"',
        '```'
      ].join('\n'),
      preview: false
    })

    expect(applied.result.applied).toHaveLength(1)
    expect(fs.readFileSync(file, 'utf8')).toBe('export const hello = "there"\n')

    const status = await call(2, 'state.status')
    expect(status.result.can_revert).toBe(true)

    const reverted = await call(3, 'response.revert')
    expect(reverted.result.failed).toHaveLength(0)
    expect(fs.readFileSync(file, 'utf8')).toBe('export const hello = "world"\n')
  })

  it('reports nothing to undo', async () => {
    const { call } = make_harness(workspace)
    const response = await call(1, 'response.revert')
    expect(response.result.error).toBe('Nothing to undo.')
  })
})
