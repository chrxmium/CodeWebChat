import type { Host } from '../host'
import { resolve_safe_path } from '../utils/safe-path'
import type { OriginalFileState } from '../types'

export type RevertResult = {
  reverted: string[]
  failed: { file_path: string; error: string }[]
}

/**
 * Restores files to the content recorded before an apply. Mirrors the editor's
 * `undo_files`: delete files that were created, move renames back, recreate
 * deleted files and restore edited ones.
 */
export const revert_changes = async (params: {
  host: Host
  states: OriginalFileState[]
}): Promise<RevertResult> => {
  const { host, states } = params
  const roots = await host.get_workspace_roots()

  const find_root = (name?: string) =>
    roots.find((r) => r.name === name) ?? roots[0]

  const reverted: string[] = []
  const failed: RevertResult['failed'] = []

  for (const state of states) {
    const root = find_root(state.workspace_name)

    if (!root) {
      failed.push({
        file_path: state.file_path,
        error: 'No workspace root for this file.'
      })
      continue
    }

    const absolute_path = resolve_safe_path(root.path, state.file_path)
    if (!absolute_path) {
      failed.push({
        file_path: state.file_path,
        error: 'Unsafe file path.'
      })
      continue
    }

    try {
      if (state.file_state === 'new' && !state.file_path_to_restore) {
        if (await host.exists(absolute_path)) {
          await host.delete_file(absolute_path)
        }
        reverted.push(state.file_path)
        continue
      }

      if (state.file_path_to_restore) {
        const restore_root = find_root(state.restore_workspace_name)
        const restore_path = restore_root
          ? resolve_safe_path(restore_root.path, state.file_path_to_restore)
          : null

        if (!restore_path) {
          failed.push({
            file_path: state.file_path,
            error: 'Unsafe restore path.'
          })
          continue
        }

        if (!state.is_pure_rename && (await host.exists(absolute_path))) {
          await host.write_file(restore_path, state.content)
          await host.delete_file(absolute_path)
        } else if (await host.exists(absolute_path)) {
          await host.rename_file(absolute_path, restore_path)
        }
        reverted.push(state.file_path)
        continue
      }

      await host.write_file(absolute_path, state.content)
      reverted.push(state.file_path)
    } catch (error) {
      failed.push({
        file_path: state.file_path,
        error: (error as Error).message
      })
    }
  }

  return { reverted, failed }
}
