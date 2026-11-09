import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { Task } from '@shared/types/task'

export class GlobalWorkspaceStorage<T> {
  constructor(private filename: string) {}

  public get_file_path(extension_context: vscode.ExtensionContext): string {
    return path.join(extension_context.globalStorageUri.fsPath, this.filename)
  }

  public load_all(
    extension_context: vscode.ExtensionContext
  ): Record<string, T> {
    const file_path = this.get_file_path(extension_context)
    try {
      if (fs.existsSync(file_path)) {
        const content = fs.readFileSync(file_path, 'utf8')
        return JSON.parse(content)
      }
    } catch (error) {
      console.error(
        `Error loading global workspace storage (${this.filename}):`,
        error
      )
    }
    return {}
  }

  public save_all(
    extension_context: vscode.ExtensionContext,
    data: Record<string, T>
  ): void {
    const file_path = this.get_file_path(extension_context)
    const dir_path = path.dirname(file_path)

    if (!fs.existsSync(dir_path)) {
      fs.mkdirSync(dir_path, { recursive: true })
    }

    try {
      const temp_path = file_path + '.tmp'
      fs.writeFileSync(temp_path, JSON.stringify(data, null, 2), 'utf8')
      fs.renameSync(temp_path, file_path)
    } catch (error) {
      console.error(
        `Failed to save to global workspace storage (${this.filename}):`,
        error
      )
    }
  }
}

export const RangesStorage = new GlobalWorkspaceStorage<Record<string, string>>(
  'ranges.json'
)
export const TasksStorage = new GlobalWorkspaceStorage<Task[]>('tasks.json')
