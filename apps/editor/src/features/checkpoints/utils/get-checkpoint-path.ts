import * as path from 'path'
import * as vscode from 'vscode'
import { get_checkpoints_storage_key } from './get-checkpoints-storage-key'

export const get_checkpoint_path = (
  timestamp: number,
  extension_context: vscode.ExtensionContext
): string => {
  const workspace_hash = get_checkpoints_storage_key(extension_context)
  return path.join(
    extension_context.globalStorageUri.fsPath,
    'checkpoints',
    workspace_hash,
    timestamp.toString()
  )
}
