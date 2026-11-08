import * as path from 'path'
import { apply_response, revert_changes, to_original_states } from '@cwc/core'
import {
  build_chatbot_prompt,
  ContextFile
} from '@cwc/core/prompt/build-prompt'
import type { Host } from '@cwc/core/host'
import type { ApplyStrategy, OriginalFileState } from '@cwc/core/types'
import { CHATBOTS } from '@shared/constants/chatbots'
import type { JsonRpcPeer } from './json-rpc'
import type { ConnectorServer } from './websocket-server'

export type SidecarState = {
  last_states: OriginalFileState[]
  last_strategy: ApplyStrategy | null
}

export type SidecarDeps = {
  peer: JsonRpcPeer
  host: Host
  server: ConnectorServer
  state: SidecarState
}

const resolve_relative = (root_path: string, absolute_path: string) =>
  path.relative(root_path, absolute_path).replace(/\\/g, '/')

/**
 * Collects context files for the prompt: the host's selection (or an explicit
 * list), read through the host so the editor's unsaved buffers are used.
 */
export const collect_context_files = async (params: {
  host: Host
  paths?: string[]
}): Promise<ContextFile[]> => {
  const roots = await params.host.get_workspace_roots()
  const selected = params.paths ?? (await params.host.get_selected_files())
  const files: ContextFile[] = []

  for (const absolute_path of selected) {
    const root =
      roots.find((candidate) => absolute_path.startsWith(candidate.path)) ??
      roots[0]
    if (!root) continue

    const content = await params.host.read_file(absolute_path)
    const is_binary = content === null

    files.push({
      path: resolve_relative(root.path, absolute_path),
      content: is_binary ? undefined : (content as string),
      is_binary,
      modified_at: undefined
    })
  }

  return files
}

export const resolve_chatbot_url = (params: {
  chatbot: string
  model?: string
}): string | undefined => {
  const chatbot = CHATBOTS[params.chatbot as keyof typeof CHATBOTS]
  if (!chatbot) return undefined

  let url: string = chatbot.url

  if (params.chatbot === 'AI Studio' && params.model) {
    url = `${url}?model=${params.model}`
  } else if (params.chatbot === 'Arena' && params.model) {
    url = `https://arena.ai/?mode=direct&model=${params.model}`
  } else if (params.chatbot === 'Open WebUI') {
    url = 'http://openwebui/'
  }

  return url
}

export const register_methods = (deps: SidecarDeps): void => {
  const { peer, host, server, state } = deps

  peer.register('ping', () => ({ ok: true, pid: process.pid }))

  peer.register('browsers.list', () => ({ browsers: server.get_browsers() }))

  // File/context picker for the tool window: relative and absolute paths.
  peer.register('workspace.files', async () => {
    const roots = await host.get_workspace_roots()
    if (roots.length === 0) return { roots: [], files: [] }

    const root = roots[0]
    const files = await host.list_workspace_files(root)

    return {
      root: { name: root.name, path: root.path },
      files: files.map((relative) => ({
        relative,
        absolute: path.join(root.path, relative)
      }))
    }
  })

  peer.register('prompt.build', async (params: any) => {
    const files = await collect_context_files({
      host,
      paths: params?.paths
    })

    if (files.length === 0) {
      throw new Error('Context is empty: select at least one file.')
    }

    const { text } = build_chatbot_prompt({
      files,
      instructions: params?.instructions ?? '',
      prompt_type: params?.prompt_type ?? 'edit',
      edit_format: params?.edit_format ?? 'truncated',
      completed_tasks: params?.completed_tasks
    })

    return { text, file_count: files.length }
  })

  peer.register('chat.initialize', async (params: any) => {
    const url =
      params?.url ??
      resolve_chatbot_url({ chatbot: params?.chatbot, model: params?.model })

    if (!url) {
      throw new Error(`Unknown chatbot: ${params?.chatbot}`)
    }

    const chatbot = CHATBOTS[params.chatbot as keyof typeof CHATBOTS] as any

    const result = server.send_initialize_chat({
      action: 'initialize-chat',
      text: params?.text ?? '',
      url,
      chatbot: params?.chatbot,
      model: params?.model,
      target_browser_id: params?.target_browser_id,
      system_instructions:
        params?.system_instructions ??
        (chatbot?.supports_system_instructions
          ? chatbot.default_system_instructions
          : undefined),
      options: params?.options,
      raw_instructions: params?.raw_instructions,
      inject_apply_response_button: params?.inject_apply_response_button ?? true
    })

    if (!result.sent) {
      throw new Error(
        'No browser connected. Open the Connector extension and try again.'
      )
    }

    return { sent: true, browser: result.browser }
  })

  peer.register('response.apply', async (params: any) => {
    const result = await apply_response({
      host,
      options: {
        response: params?.response ?? '',
        instructions: params?.instructions,
        preview: params?.preview ?? true
      }
    })

    if (result.applied.length > 0) {
      state.last_states = to_original_states(result.applied)
      state.last_strategy = result.strategy
    }

    return {
      applied: result.applied.map((change) => ({
        file_path: change.file_path,
        workspace_name: change.workspace_name,
        kind: change.kind
      })),
      rejected: result.rejected.map((change) => ({
        file_path: change.file_path,
        workspace_name: change.workspace_name
      })),
      strategy: result.strategy,
      error: result.error
    }
  })

  peer.register('response.revert', async () => {
    if (state.last_states.length === 0) {
      return { reverted: [], failed: [], error: 'Nothing to undo.' }
    }

    const result = await revert_changes({ host, states: state.last_states })

    if (result.failed.length === 0) {
      state.last_states = []
      state.last_strategy = null
    }

    return result
  })

  peer.register('state.status', () => ({
    can_revert: state.last_states.length > 0,
    files: state.last_states.map((s) => s.file_path)
  }))
}
