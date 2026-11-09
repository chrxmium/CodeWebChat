import * as crypto from 'crypto'
import * as vscode from 'vscode'
import { normalize_path } from '@/utils/normalize-path'
import { CHECKPOINTS_WORKSPACE_ID_STATE_KEY } from '@/constants/state-keys'

export const get_checkpoints_storage_key = (
  extension_context: vscode.ExtensionContext
): string => {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) {
    throw new Error('Checkpoints are only supported when a workspace is open')
  }

  let workspace_id = extension_context.workspaceState.get<string>(
    CHECKPOINTS_WORKSPACE_ID_STATE_KEY
  )

  const paths = folders.map((folder) => normalize_path(folder.uri.fsPath))
  paths.sort()
  const raw_id = paths.join(',')
  const expected_id = crypto
    .createHash('sha256')
    .update(raw_id)
    .digest('hex')
    .substring(0, 16)

  if (workspace_id !== expected_id) {
    workspace_id = expected_id
    extension_context.workspaceState.update(
      CHECKPOINTS_WORKSPACE_ID_STATE_KEY,
      workspace_id
    )
  }

  return workspace_id
}
