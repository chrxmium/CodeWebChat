import * as vscode from 'vscode'
import type { Checkpoint } from '../types'
import { get_checkpoint_path } from '../utils'
import { ResponseHistoryItem } from '@shared/types/response-history-item'
import {
  load_checkpoints_metadata,
  save_checkpoints_metadata
} from '../utils/checkpoints-metadata'

export const accept_checkpoint = async (params: {
  extension_context: vscode.ExtensionContext
  checkpoint: Checkpoint
  history_for_checkpoint: ResponseHistoryItem[]
  created_at_for_preview?: number
}) => {
  const checkpoints = await load_checkpoints_metadata(params.extension_context)

  const checkpoint_index = checkpoints.findIndex(
    (c) => c.timestamp === params.checkpoint.timestamp
  )
  if (checkpoint_index !== -1) {
    const checkpoint_to_update = checkpoints[checkpoint_index]
    const old_timestamp = checkpoint_to_update.timestamp
    const new_timestamp = Date.now()
    const old_path = get_checkpoint_path(
      old_timestamp,
      params.extension_context
    )
    const new_path = get_checkpoint_path(
      new_timestamp,
      params.extension_context
    )
    try {
      await vscode.workspace.fs.rename(
        vscode.Uri.file(old_path),
        vscode.Uri.file(new_path)
      )
      checkpoint_to_update.timestamp = new_timestamp
    } catch (err) {
      console.error(
        `Failed to rename checkpoint directory for timestamp update:`,
        err
      )
      return
    }
    checkpoint_to_update.trigger = 'response-accepted'
    checkpoint_to_update.response_preview_item_created_at =
      params.created_at_for_preview

    try {
      const history_file_path = vscode.Uri.joinPath(
        vscode.Uri.file(new_path),
        'response-history.json'
      )
      await vscode.workspace.fs.writeFile(
        history_file_path,
        new TextEncoder().encode(JSON.stringify(params.history_for_checkpoint))
      )
    } catch (err) {
      console.error(`Failed to write response-history.json:`, err)
    }

    checkpoints.sort((a, b) => b.timestamp - a.timestamp)

    await save_checkpoints_metadata(params.extension_context, checkpoints)
  }
}
