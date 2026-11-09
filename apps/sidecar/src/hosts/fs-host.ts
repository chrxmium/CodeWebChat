import * as fs from 'fs'
import * as path from 'path'
import type { Host, ProposedChange, WorkspaceRoot } from '@cwc/core/host'

/**
 * File-system host used when the sidecar runs standalone (`--workspace`), and by
 * the sidecar tests. The JetBrains plugin uses `RpcHost` instead so that writes
 * and diffs go through the IDE.
 */
export class FsHost implements Host {
  private selected: string[] = []

  constructor(
    private readonly roots: WorkspaceRoot[],
    private readonly logger: (message: string) => void = () => {}
  ) {}

  async get_workspace_roots(): Promise<WorkspaceRoot[]> {
    return this.roots
  }

  async read_file(absolute_path: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(absolute_path, 'utf8')
    } catch {
      return null
    }
  }

  async write_file(absolute_path: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(absolute_path), { recursive: true })
    await fs.promises.writeFile(absolute_path, content, 'utf8')
  }

  async delete_file(absolute_path: string): Promise<void> {
    await fs.promises.rm(absolute_path, { force: true })
  }

  async rename_file(
    from_absolute_path: string,
    to_absolute_path: string
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(to_absolute_path), {
      recursive: true
    })
    await fs.promises.rename(from_absolute_path, to_absolute_path)
  }

  async exists(absolute_path: string): Promise<boolean> {
    try {
      await fs.promises.stat(absolute_path)
      return true
    } catch {
      return false
    }
  }

  async list_workspace_files(root: WorkspaceRoot): Promise<string[]> {
    const result: string[] = []
    const skip = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'target',
      'vendor',
      '.venv',
      'bin',
      'obj'
    ])

    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || skip.has(entry.name)) continue
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), relative)
        } else {
          result.push(relative)
        }
      }
    }

    await walk(root.path, '')
    return result
  }

  async get_selected_files(): Promise<string[]> {
    return this.selected
  }

  set_selected_files(paths: string[]): void {
    this.selected = paths
  }

  async confirm_changes(params: {
    changes: ProposedChange[]
    instructions?: string
  }): Promise<string[] | null> {
    // Standalone mode has no UI: accept everything and log a summary.
    this.logger(
      `Applying ${params.changes.length} change(s) without preview (no editor attached)`
    )
    return params.changes.map((change) => change.id)
  }

  info(message: string): void {
    this.logger(message)
  }

  error(message: string): void {
    this.logger(message)
  }
}
