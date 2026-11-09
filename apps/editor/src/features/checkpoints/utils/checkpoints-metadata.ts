import * as vscode from 'vscode'
import * as path from 'path'
import type { Checkpoint } from '../types'
import { get_checkpoints_storage_key } from './get-checkpoints-storage-key'
import { Logger } from '@shared/utils/logger'
import { CHECKPOINT_LIFESPAN } from '@/constants/values'

export const get_checkpoints_metadata_path = (
  extension_context: vscode.ExtensionContext
): string => {
  const workspace_hash = get_checkpoints_storage_key(extension_context)
  return path.join(
    extension_context.globalStorageUri.fsPath,
    'checkpoints',
    workspace_hash,
    'metadata.json'
  )
}

export const load_checkpoints_metadata = async (
  extension_context: vscode.ExtensionContext
): Promise<Checkpoint[]> => {
  const metadata_path = get_checkpoints_metadata_path(extension_context)
  try {
    const uri = vscode.Uri.file(metadata_path)
    const content = await vscode.workspace.fs.readFile(uri)
    return JSON.parse(new TextDecoder().decode(content))
  } catch {
    return []
  }
}

export const checkpoints_cleanup = async (
  extension_context: vscode.ExtensionContext
) => {
  const checkpoints_dir = vscode.Uri.file(
    path.join(extension_context.globalStorageUri.fsPath, 'checkpoints')
  )
  try {
    const entries = await vscode.workspace.fs.readDirectory(checkpoints_dir)
    const now = Date.now()

    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        const workspace_dir = vscode.Uri.joinPath(checkpoints_dir, name)
        try {
          let last_updated = 0

          try {
            const metadata_uri = vscode.Uri.joinPath(
              workspace_dir,
              'metadata.json'
            )
            const stat = await vscode.workspace.fs.stat(metadata_uri)
            last_updated = stat.mtime

            const content = await vscode.workspace.fs.readFile(metadata_uri)
            const metadata: Checkpoint[] = JSON.parse(
              new TextDecoder().decode(content)
            )
            for (const c of metadata) {
              if (c.timestamp > last_updated) last_updated = c.timestamp
            }
          } catch {
            const stat = await vscode.workspace.fs.stat(workspace_dir)
            last_updated = stat.mtime
          }

          if (now - last_updated > CHECKPOINT_LIFESPAN) {
            await vscode.workspace.fs.delete(workspace_dir, { recursive: true })
            Logger.info({
              function_name: 'cleanup_old_workspaces',
              message: `Removed old workspace checkpoints folder: ${name}`
            })
          }
        } catch {}
      }
    }
  } catch {}
}

export const save_checkpoints_metadata = async (
  extension_context: vscode.ExtensionContext,
  checkpoints: Checkpoint[]
): Promise<void> => {
  const metadata_path = get_checkpoints_metadata_path(extension_context)
  try {
    const uri = vscode.Uri.file(metadata_path)
    const temp_uri = vscode.Uri.file(metadata_path + '.tmp')
    const dir_uri = vscode.Uri.file(path.dirname(metadata_path))
    await vscode.workspace.fs.createDirectory(dir_uri)
    await vscode.workspace.fs.writeFile(
      temp_uri,
      new TextEncoder().encode(JSON.stringify(checkpoints, null, 2))
    )
    await vscode.workspace.fs.rename(temp_uri, uri, { overwrite: true })
  } catch (error) {
    Logger.error({
      function_name: 'save_checkpoints_metadata',
      message: 'Failed to save checkpoints metadata',
      data: error
    })
  }
}
