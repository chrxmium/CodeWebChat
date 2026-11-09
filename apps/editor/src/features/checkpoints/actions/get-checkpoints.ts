import * as vscode from 'vscode'
import type { Checkpoint } from '../types'
import { get_checkpoint_path } from '../utils'
import { Logger } from '@shared/utils/logger'
import { CHECKPOINT_LIFESPAN } from '@/constants/values'
import {
  load_checkpoints_metadata,
  save_checkpoints_metadata
} from '../utils/checkpoints-metadata'

export const remove_old_checkpoints = async (
  checkpoints: Checkpoint[],
  extension_context: vscode.ExtensionContext
): Promise<Checkpoint[]> => {
  const now = Date.now()
  const cutoff_time = now - CHECKPOINT_LIFESPAN

  const checkpoints_to_keep: Checkpoint[] = []
  const checkpoints_to_remove: Checkpoint[] = []

  for (const checkpoint of checkpoints) {
    if (checkpoint.timestamp < cutoff_time) {
      checkpoints_to_remove.push(checkpoint)
    } else {
      checkpoints_to_keep.push(checkpoint)
    }
  }

  for (const checkpoint of checkpoints_to_remove) {
    try {
      const checkpoint_path = get_checkpoint_path(
        checkpoint.timestamp,
        extension_context
      )
      await vscode.workspace.fs.delete(vscode.Uri.file(checkpoint_path), {
        recursive: true
      })
      Logger.info({
        function_name: 'remove_old_checkpoints',
        message: `Removed old checkpoint: ${checkpoint.trigger}`,
        data: { timestamp: checkpoint.timestamp }
      })
    } catch (error) {
      Logger.warn({
        function_name: 'remove_old_checkpoints',
        message: 'Could not delete old checkpoint file',
        data: error
      })
    }
  }

  return checkpoints_to_keep
}

export const get_checkpoints = async (
  extension_context: vscode.ExtensionContext
): Promise<Checkpoint[]> => {
  const checkpoints = await load_checkpoints_metadata(extension_context)

  const valid_checkpoints: Checkpoint[] = []
  let state_updated = false
  for (const checkpoint of checkpoints) {
    try {
      const checkpoint_path = get_checkpoint_path(
        checkpoint.timestamp,
        extension_context
      )
      await vscode.workspace.fs.stat(vscode.Uri.file(checkpoint_path))
      if (checkpoint.trigger !== 'temporary') valid_checkpoints.push(checkpoint)
    } catch {
      state_updated = true
    }
  }

  if (state_updated) {
    await save_checkpoints_metadata(extension_context, valid_checkpoints)
  }

  return valid_checkpoints
}
