import * as fs from 'fs/promises'
import * as path from 'path'
import * as vscode from 'vscode'
import {
  WorkspaceProvider,
  FileItem
} from '../context/providers/workspace/workspace-provider'
import { LAST_RANGES_SAVE_LOCATION_STATE_KEY } from '../constants/state-keys'
import { t } from '../i18n'
import { get_error_message } from '@/utils/get-error-message'
import { is_binary_file } from '../utils/is-binary'
import { RangesStorage } from '../utils/global-workspace-storage'
import { normalize_path } from '../utils/normalize-path'

export const set_ranges_command = (
  workspace_provider: WorkspaceProvider,
  extension_context: vscode.ExtensionContext
) => {
  return vscode.commands.registerCommand(
    'codeWebChat.setRanges',
    async (item: FileItem) => {
      if (!item || !item.resourceUri) {
        return
      }

      const file_path = item.resourceUri.fsPath
      const workspace_folder = vscode.workspace.getWorkspaceFolder(
        item.resourceUri
      )

      if (!workspace_folder) {
        vscode.window.showErrorMessage(
          t('command.set-ranges-command.not-in-workspace')
        )
        return
      }

      let is_binary = is_binary_file(file_path)
      if (!is_binary) {
        try {
          const file_handle = await fs.open(file_path, 'r')
          const buffer = new Uint8Array(8000)
          const { bytesRead } = await file_handle.read(buffer, 0, 8000, 0)
          await file_handle.close()
          is_binary = is_binary_file(file_path, buffer.subarray(0, bytesRead))
        } catch {}
      }

      if (is_binary) {
        vscode.window.showWarningMessage(
          t('command.set-ranges-command.is-binary')
        )
        return
      }

      const relative_path = normalize_path(
        path.relative(workspace_folder.uri.fsPath, file_path)
      )

      const ranges_file_path = path.join(
        workspace_folder.uri.fsPath,
        '.vscode',
        'ranges.json'
      )
      const file_ranges: Record<string, string> = {}
      try {
        const content = await fs.readFile(ranges_file_path, 'utf-8')
        const raw_ranges = JSON.parse(content)
        for (const [key, value] of Object.entries(raw_ranges)) {
          file_ranges[normalize_path(key)] = value as string
        }
      } catch {}

      const all_global_ranges = RangesStorage.load_all(extension_context)
      const global_ranges_for_workspace =
        all_global_ranges[workspace_folder.uri.fsPath] || {}

      const file_range_value = file_ranges[relative_path]
      const state_range_value = global_ranges_for_workspace[relative_path]
      const current_range = file_range_value || state_range_value

      const new_ranges = await vscode.window.showInputBox({
        prompt: t('command.set-ranges-command.prompt'),
        title: t('command.set-ranges-command.title'),
        placeHolder: t('command.set-ranges-command.placeholder'),
        value: current_range,
        validateInput: (value) => {
          if (value.trim() === '') return null

          const parts = value
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
          const parsed_ranges: {
            start: number
            end: number
            original: string
          }[] = []

          for (const part of parts) {
            const match = part.match(/^(\d+)?-(\d+)?$/)
            if (!match) {
              return t('command.set-ranges-command.validation.invalid-format', {
                part
              })
            }

            const [, start_str, end_str] = match

            if (!start_str && !end_str) {
              return t('command.set-ranges-command.validation.invalid-range')
            }

            const start = start_str ? parseInt(start_str, 10) : null
            const end = end_str ? parseInt(end_str, 10) : null

            if (start !== null && start < 1) {
              return t(
                'command.set-ranges-command.validation.start-greater-than-0',
                {
                  part
                }
              )
            }

            if (end !== null && end < 1) {
              return t(
                'command.set-ranges-command.validation.end-greater-than-0',
                { part }
              )
            }

            if (start !== null && end !== null) {
              if (start > end) {
                return t(
                  'command.set-ranges-command.validation.start-greater-than-end',
                  {
                    part
                  }
                )
              }
              if (start === end) {
                return t(
                  'command.set-ranges-command.validation.start-equals-end',
                  { part }
                )
              }
            }
            parsed_ranges.push({
              start: start ?? 1,
              end: end ?? Number.MAX_SAFE_INTEGER,
              original: part
            })
          }
          parsed_ranges.sort((a, b) => a.start - b.start)

          for (let i = 0; i < parsed_ranges.length - 1; i++) {
            if (parsed_ranges[i].end >= parsed_ranges[i + 1].start) {
              return t('command.set-ranges-command.validation.overlap', {
                part1: parsed_ranges[i].original,
                part2: parsed_ranges[i + 1].original
              })
            }
          }
          return null
        }
      })

      if (new_ranges === undefined) {
        return
      }

      if (!new_ranges) {
        let changed = false
        if (file_ranges[relative_path]) {
          delete file_ranges[relative_path]
          try {
            if (Object.keys(file_ranges).length === 0) {
              await fs.unlink(ranges_file_path).catch(() => {})
            } else {
              const temp_path = ranges_file_path + '.tmp'
              await fs.writeFile(
                temp_path,
                JSON.stringify(file_ranges, null, 2)
              )
              await fs.rename(temp_path, ranges_file_path)
            }
            changed = true
          } catch (error) {
            vscode.window.showErrorMessage(
              t('command.set-ranges-command.error.update-file', {
                error: get_error_message(error)
              })
            )
          }
        }

        if (state_range_value) {
          const updated_all = { ...all_global_ranges }
          if (updated_all[workspace_folder.uri.fsPath]) {
            delete updated_all[workspace_folder.uri.fsPath][relative_path]
            if (
              Object.keys(updated_all[workspace_folder.uri.fsPath]).length === 0
            ) {
              delete updated_all[workspace_folder.uri.fsPath]
            }
          }
          RangesStorage.save_all(extension_context, updated_all)
          changed = true
        }

        if (changed) {
          await workspace_provider.load_all_ranges()
        }
        return
      }

      let save_location: 'file' | 'state' | undefined

      if (file_range_value) save_location = 'file'
      else if (state_range_value) save_location = 'state'
      else {
        const last_location = extension_context.workspaceState.get<
          'file' | 'state' | undefined
        >(LAST_RANGES_SAVE_LOCATION_STATE_KEY)

        const choice = await vscode.window.showQuickPick(
          [
            {
              label: t('common.source.json-file'),
              description: t(
                'command.set-ranges-command.quick-pick.json-file-description'
              ),
              picked: last_location !== 'state'
            },
            {
              label: t('common.source.extension-storage'),
              description: t(
                'command.set-ranges-command.quick-pick.extension-storage-description'
              ),
              picked: last_location === 'state'
            }
          ],
          {
            placeHolder: t('command.set-ranges-command.quick-pick.placeholder')
          }
        )

        if (!choice) return
        save_location =
          choice.label === t('common.source.json-file') ? 'file' : 'state'
        await extension_context.workspaceState.update(
          LAST_RANGES_SAVE_LOCATION_STATE_KEY,
          save_location
        )
      }

      if (new_ranges) {
        const formatted_range = new_ranges
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .join(' ')

        if (save_location === 'file') {
          file_ranges[relative_path] = formatted_range
          try {
            await fs.mkdir(path.dirname(ranges_file_path), { recursive: true })
            const temp_path = ranges_file_path + '.tmp'
            await fs.writeFile(temp_path, JSON.stringify(file_ranges, null, 2))
            await fs.rename(temp_path, ranges_file_path)

            if (state_range_value) {
              const updated_all = { ...all_global_ranges }
              if (updated_all[workspace_folder.uri.fsPath]) {
                delete updated_all[workspace_folder.uri.fsPath][relative_path]
                if (
                  Object.keys(updated_all[workspace_folder.uri.fsPath])
                    .length === 0
                ) {
                  delete updated_all[workspace_folder.uri.fsPath]
                }
              }
              RangesStorage.save_all(extension_context, updated_all)
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              t('command.set-ranges-command.error.save-file', {
                error: get_error_message(error)
              })
            )
          }
        } else {
          const updated_all = { ...all_global_ranges }
          if (!updated_all[workspace_folder.uri.fsPath]) {
            updated_all[workspace_folder.uri.fsPath] = {}
          }
          updated_all[workspace_folder.uri.fsPath][relative_path] =
            formatted_range

          RangesStorage.save_all(extension_context, updated_all)

          if (file_ranges[relative_path]) {
            delete file_ranges[relative_path]
            try {
              if (Object.keys(file_ranges).length === 0) {
                await fs.unlink(ranges_file_path).catch(() => {})
              } else {
                const temp_path = ranges_file_path + '.tmp'
                await fs.writeFile(
                  temp_path,
                  JSON.stringify(file_ranges, null, 2)
                )
                await fs.rename(temp_path, ranges_file_path)
              }
            } catch (error) {
              vscode.window.showErrorMessage(
                t('command.set-ranges-command.error.cleanup-file', {
                  error: get_error_message(error)
                })
              )
            }
          }
        }

        await workspace_provider.load_all_ranges()
      }
    }
  )
}
