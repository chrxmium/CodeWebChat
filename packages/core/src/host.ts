import type { ProposedChange } from './types'

export type { ProposedChange }

export type WorkspaceRoot = {
  name: string
  path: string
}

/**
 * Everything the core needs from an editor. The core never imports `vscode`
 * (or any other editor SDK); `apps/editor` and `apps/jetbrains` provide
 * implementations through their sidecar host.
 *
 * All paths are absolute unless the name says `relative`.
 */
export interface Host {
  get_workspace_roots(): Promise<WorkspaceRoot[]>

  /** Returns null when the file or directory does not exist. */
  read_file(absolute_path: string): Promise<string | null>
  write_file(absolute_path: string, content: string): Promise<void>
  delete_file(absolute_path: string): Promise<void>
  rename_file(
    from_absolute_path: string,
    to_absolute_path: string
  ): Promise<void>
  exists(absolute_path: string): Promise<boolean>

  /** Relative, posix-separated paths of the workspace, for file pickers. */
  list_workspace_files(root: WorkspaceRoot): Promise<string[]>

  /** Absolute paths of the current context selection. */
  get_selected_files(): Promise<string[]>

  /**
   * Shows a diff for each change before anything is written. Returns the ids
   * the user accepted, or null to cancel the whole apply.
   */
  confirm_changes?(params: {
    changes: ProposedChange[]
    instructions?: string
  }): Promise<string[] | null>

  info(message: string): void
  error(message: string): void
}
