import * as vscode from 'vscode'
import * as path from 'path'
import { Logger } from '@shared/utils/logger'
import { get_error_message } from '@/utils/get-error-message'
import type { Checkpoint } from '@/features/checkpoints/types'
import { get_checkpoint_path } from '@/features/checkpoints/utils'
import {
  load_checkpoints_metadata,
  save_checkpoints_metadata
} from '@/features/checkpoints/utils/checkpoints-metadata'

export const CHECKPOINTS_STATE_KEY = 'checkpoints'

const MIGRATION_ID = 'checkpoints-to-global-storage-migration-20261109'

export async function migrate_checkpoints_to_global_storage(
  extension_context: vscode.ExtensionContext
): Promise<void> {
  try {
    if (extension_context.workspaceState.get(MIGRATION_ID)) {
      return
    }

    const state_checkpoints = extension_context.workspaceState.get<
      Checkpoint[]
    >(CHECKPOINTS_STATE_KEY)

    if (state_checkpoints && state_checkpoints.length > 0) {
      const existing = await load_checkpoints_metadata(extension_context)

      const combined = [...existing, ...state_checkpoints]

      for (const checkpoint of combined) {
        const old_checkpoint_path = path.join(
          extension_context.globalStorageUri.fsPath,
          'checkpoints',
          `cwc-checkpoint-${checkpoint.timestamp}`
        )
        const new_checkpoint_path = get_checkpoint_path(
          checkpoint.timestamp,
          extension_context
        )

        try {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(path.dirname(new_checkpoint_path))
          )
          await vscode.workspace.fs.rename(
            vscode.Uri.file(old_checkpoint_path),
            vscode.Uri.file(new_checkpoint_path)
          )
        } catch {}

        const any_checkpoint = checkpoint as any
        if (any_checkpoint.response_history || any_checkpoint.completed_tasks) {
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(new_checkpoint_path))

            if (any_checkpoint.response_history) {
              const history_file_path = vscode.Uri.joinPath(
                vscode.Uri.file(new_checkpoint_path),
                'response-history.json'
              )
              await vscode.workspace.fs.writeFile(
                history_file_path,
                new TextEncoder().encode(
                  JSON.stringify(any_checkpoint.response_history)
                )
              )
            }

            if (any_checkpoint.completed_tasks) {
              const completed_tasks_file_path = vscode.Uri.joinPath(
                vscode.Uri.file(new_checkpoint_path),
                'completed-tasks.json'
              )
              await vscode.workspace.fs.writeFile(
                completed_tasks_file_path,
                new TextEncoder().encode(
                  JSON.stringify(any_checkpoint.completed_tasks)
                )
              )
            }
          } catch {}
          delete any_checkpoint.response_history
          delete any_checkpoint.completed_tasks
        }
      }

      const unique = Array.from(
        new Map(combined.map((c) => [c.timestamp, c])).values()
      )
      unique.sort((a, b) => b.timestamp - a.timestamp)

      await save_checkpoints_metadata(extension_context, unique)
    }

    const temp_checkpoint = extension_context.workspaceState.get<Checkpoint>(
      'temporary-checkpoint'
    )

    if (temp_checkpoint) {
      const old_temp_path = path.join(
        extension_context.globalStorageUri.fsPath,
        'checkpoints',
        `cwc-checkpoint-${temp_checkpoint.timestamp}`
      )
      const new_temp_path = get_checkpoint_path(
        temp_checkpoint.timestamp,
        extension_context
      )

      try {
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.file(path.dirname(new_temp_path))
        )
        await vscode.workspace.fs.rename(
          vscode.Uri.file(old_temp_path),
          vscode.Uri.file(new_temp_path)
        )
      } catch {}
    }

    await extension_context.workspaceState.update(MIGRATION_ID, true)
    await extension_context.workspaceState.update(
      CHECKPOINTS_STATE_KEY,
      undefined
    )

    Logger.info({
      function_name: 'migrate_checkpoints_to_global_storage',
      message: 'Successfully migrated checkpoints to global storage'
    })
  } catch (error) {
    Logger.error({
      function_name: 'migrate_checkpoints_to_global_storage',
      message: 'Error migrating checkpoints to global storage',
      data: get_error_message(error)
    })
  }
}
