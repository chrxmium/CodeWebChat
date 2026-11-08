import { JsonRpcPeer } from './json-rpc'

const make_peer = () => {
  const out: any[] = []
  const peer = new JsonRpcPeer((line) => out.push(JSON.parse(line)))
  return { peer, out }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('JsonRpcPeer', () => {
  it('answers requests', async () => {
    const { peer, out } = make_peer()
    peer.register('add', (params: any) => params.a + params.b)

    peer.handle_line(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'add',
        params: { a: 2, b: 3 }
      })
    )
    await flush()

    expect(out[0]).toEqual({ jsonrpc: '2.0', id: 7, result: 5 })
  })

  it('reports unknown methods', async () => {
    const { peer, out } = make_peer()

    peer.handle_line(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nope' }))
    await flush()

    expect(out[0].error.code).toBe(-32601)
  })

  it('routes notifications without replying', async () => {
    const { peer, out } = make_peer()
    const received: any[] = []
    peer.on_notification = (method, params) => received.push({ method, params })

    peer.handle_line(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'browsers.changed',
        params: { browsers: [] }
      })
    )
    await flush()

    expect(out).toHaveLength(0)
    expect(received[0].method).toBe('browsers.changed')
  })

  it('resolves outgoing requests', async () => {
    const { peer, out } = make_peer()

    const promise = peer.request('host.readFile', { path: '/tmp/a' })

    peer.handle_line(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: 'hi' } })
    )

    await expect(promise).resolves.toEqual({ content: 'hi' })
    expect(out[0].method).toBe('host.readFile')
  })

  it('rejects outgoing requests on error', async () => {
    const { peer } = make_peer()
    const promise = peer.request('host.writeFile')

    peer.handle_line(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'disk full' }
      })
    )

    await expect(promise).rejects.toThrow('disk full')
  })
})
