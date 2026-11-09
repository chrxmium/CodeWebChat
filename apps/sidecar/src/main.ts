import * as fs from 'fs'
import * as readline from 'readline'
import { JsonRpcPeer } from './json-rpc'
import { ConnectorServer } from './websocket-server'
import { FsHost } from './hosts/fs-host'
import { RpcHost } from './hosts/rpc-host'
import { register_methods, SidecarState } from './methods'
import { DEFAULT_PORT } from '@shared/constants/websocket'

const log = (message: string) => {
  process.stderr.write(`[cwc-sidecar] ${message}\n`)
}

type Args = {
  port: number
  workspace?: string
  roots: { name: string; path: string }[]
}

const parse_args = (argv: string[]): Args => {
  let port = DEFAULT_PORT
  let workspace: string | undefined
  const roots: { name: string; path: string }[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      port = Number(argv[++i]) || DEFAULT_PORT
    } else if (arg === '--workspace') {
      workspace = argv[++i]
    } else if (arg === '--root') {
      const value = argv[++i]
      if (value) {
        roots.push({ name: value.split(/[\\/]/).pop() ?? value, path: value })
      }
    }
  }

  if (workspace && roots.length === 0) {
    roots.push({
      name: workspace.split(/[\\/]/).pop() ?? workspace,
      path: workspace
    })
  }

  return { port, workspace, roots }
}

const main = async () => {
  const args = parse_args(process.argv.slice(2))
  const logger = (message: string) => log(message)

  const peer = new JsonRpcPeer((line) => {
    process.stdout.write(line + '\n')
  })

  // The plugin provides file I/O over JSON-RPC; standalone runs use the fs.
  const host =
    args.roots.length > 0 ? new FsHost(args.roots, logger) : new RpcHost(peer)

  const state: SidecarState = { last_states: [], last_strategy: null }

  const server = new ConnectorServer({
    port: args.port,
    on_apply_response: (message) => {
      peer.notify('chat.applyResponse', message)
    },
    on_browsers_changed: (browsers) => {
      peer.notify('browsers.changed', { browsers })
    }
  })

  register_methods({ peer, host, server, state })

  try {
    const port = await server.start(args.port)
    log(`Connector WebSocket server listening on 127.0.0.1:${port}`)
    peer.notify('sidecar.ready', { port })
  } catch (error) {
    const message = (error as NodeJS.ErrnoException).message
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      log(
        `Port ${args.port} is already in use. Another Code Web Chat server ` +
          `(for example the VS Code extension) is probably running. Stop it and retry.`
      )
    } else {
      log(`Failed to start the WebSocket server: ${message}`)
    }
    process.exit(1)
  }

  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => peer.handle_line(line))

  const shutdown = async () => {
    log('Shutting down')
    await server.stop()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  rl.on('close', shutdown)

  process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    log(`Unhandled rejection: ${String(reason)}`)
  })

  if (!fs.existsSync(args.roots[0]?.path ?? '')) {
    if (args.roots.length > 0) {
      log(`Workspace root does not exist: ${args.roots[0].path}`)
    }
  }
}

void main()
