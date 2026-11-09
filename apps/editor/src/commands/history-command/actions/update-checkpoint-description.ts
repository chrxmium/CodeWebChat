import * as vscode from 'vscode'
import { PromptViewProvider } from '@/views/prompt/backend/prompt-view-provider'
import {
  load_checkpoints_metadata,
  save_checkpoints_metadata
} from '@/features/checkpoints/utils/checkpoints-metadata'

export const update_checkpoint_description = async (params: {
  extension_context: vscode.ExtensionContext
  timestamp: number
  description: string
  prompt_view_provider: PromptViewProvider
}) => {
  const checkpoints = await load_checkpoints_metadata(params.extension_context)

  const checkpoint_to_update = checkpoints.find(
    (c) => c.timestamp === params.timestamp
  )
  if (checkpoint_to_update) {
    checkpoint_to_update.description = params.description
    await save_checkpoints_metadata(params.extension_context, checkpoints)
  }
}
