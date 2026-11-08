import type { Host, ProposedChange, WorkspaceRoot } from '@cwc/core/host'
import type { JsonRpcPeer } from '../json-rpc'

/**
 * Host that delegates every operation to the editor plugin over JSON-RPC.
 * This is what keeps the IDE in charge of writes (undo/VFS) and of the diff
 * preview, while the sidecar keeps the parsing and apply logic.
 */
export class RpcHost implements Host {
  constructor(private readonly peer: JsonRpcPeer) {}

  async get_workspace_roots(): Promise<WorkspaceRoot[]> {
    const result = await this.peer.request<{ roots: WorkspaceRoot[] }>(
      'host.getWorkspaceRoots'
    )
    return result?.roots ?? []
  }

  async read_file(absolute_path: string): Promise<string | null> {
    const result = await this.peer.request<{ content: string | null }>(
      'host.readFile',
      { path: absolute_path }
    )
    return result?.content ?? null
  }

  async write_file(absolute_path: string, content: string): Promise<void> {
    await this.peer.request('host.writeFile', {
      path: absolute_path,
      content
    })
  }

  async delete_file(absolute_path: string): Promise<void> {
    await this.peer.request('host.deleteFile', { path: absolute_path })
  }

  async rename_file(
    from_absolute_path: string,
    to_absolute_path: string
  ): Promise<void> {
    await this.peer.request('host.renameFile', {
      from: from_absolute_path,
      to: to_absolute_path
    })
  }

  async exists(absolute_path: string): Promise<boolean> {
    const result = await this.peer.request<{ exists: boolean }>('host.exists', {
      path: absolute_path
    })
    return result?.exists ?? false
  }

  async list_workspace_files(root: WorkspaceRoot): Promise<string[]> {
    const result = await this.peer.request<{ files: string[] }>(
      'host.listWorkspaceFiles',
      { root }
    )
    return result?.files ?? []
  }

  async get_selected_files(): Promise<string[]> {
    const result = await this.peer.request<{ files: string[] }>(
      'host.getSelectedFiles'
    )
    return result?.files ?? []
  }

  async confirm_changes(params: {
    changes: ProposedChange[]
    instructions?: string
  }): Promise<string[] | null> {
    const result = await this.peer.request<{
      cancel?: boolean
      acceptedIds?: string[]
    }>('host.confirmChanges', params)

    if (result?.cancel) return null
    return result?.acceptedIds ?? []
  }

  info(message: string): void {
    this.peer.notify('host.info', { message })
  }

  error(message: string): void {
    this.peer.notify('host.error', { message })
  }
}
