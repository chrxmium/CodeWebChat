import * as vscode from 'vscode'
import type { Checkpoint } from '../types'
import { get_checkpoint_path } from '../utils'
import { Logger } from '@shared/utils/logger'
import { PromptViewProvider } from '@/views/prompt/backend/prompt-view-provider'
import {
  load_checkpoints_metadata,
  save_checkpoints_metadata
} from '../utils/checkpoints-metadata'

export const delete_checkpoint = async (params: {
  extension_context: vscode.ExtensionContext
  checkpoint_to_delete: Checkpoint
  prompt_view_provider: PromptViewProvider
}) => {
  const checkpoints = await load_checkpoints_metadata(params.extension_context)

  const updated_checkpoints = checkpoints.filter(
    (c) => c.timestamp !== params.checkpoint_to_delete.timestamp
  )
  await save_checkpoints_metadata(params.extension_context, updated_checkpoints)

  try {
    const checkpoint_path = get_checkpoint_path(
      params.checkpoint_to_delete.timestamp,
      params.extension_context
    )
    await vscode.workspace.fs.delete(vscode.Uri.file(checkpoint_path), {
      recursive: true
    })
  } catch (error) {
    Logger.warn({
      function_name: 'delete_checkpoint',
      message: 'Could not delete checkpoint file',
      data: error
    })
  }
}
