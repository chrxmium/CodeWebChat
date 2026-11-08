import * as vscode from 'vscode'
import type { Host, ProposedChange, WorkspaceRoot } from '@cwc/core/host'
import type { OriginalFileState } from '@cwc/core/types'
import {
  apply_response as apply_response_core,
  revert_changes as revert_changes_core,
  to_original_states
} from '@cwc/core'

const STATE_KEY = 'codeWebChat.core.lastAppliedStates'
const DIFF_SCHEME = 'cwc-core-diff'

const diff_contents = new Map<string, string>()

/**
 * Virtual documents used by the preview, so no temp files are created.
 * Register once during activation.
 */
export const register_core_diff_provider = (
  context: vscode.ExtensionContext
): void => {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, {
      provideTextDocumentContent(uri) {
        return diff_contents.get(uri.path) ?? ''
      }
    })
  )
}

const make_diff_uri = (key: string, content: string): vscode.Uri => {
  diff_contents.set(key, content)
  return vscode.Uri.parse(`${DIFF_SCHEME}:/${key}`).with({ path: key })
}

/**
 * VS Code implementation of the core `Host` interface.
 *
 * Writes go through `WorkspaceEdit` so they land on the editor's undo stack and
 * keep the VFS and file watchers in sync. The preview uses `vscode.diff`.
 */
export class VSCodeHost implements Host {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly get_selected_files_callback: () => Promise<
      string[]
    > = async () => []
  ) {}

  async get_workspace_roots(): Promise<WorkspaceRoot[]> {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      path: folder.uri.fsPath
    }))
  }

  async read_file(absolute_path: string): Promise<string | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.file(absolute_path)
      )
      return Buffer.from(bytes).toString('utf8')
    } catch {
      return null
    }
  }

  async write_file(absolute_path: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(absolute_path)
    const exists = await this.exists(absolute_path)

    if (!exists) {
      await vscode.workspace.fs.writeFile(
        uri,
        new Uint8Array(Buffer.from(content, 'utf8'))
      )
      return
    }

    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: true
    })

    const applied = await editor.edit((edit) => {
      edit.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        ),
        content
      )
    })

    if (!applied) {
      throw new Error(`Could not write ${absolute_path}`)
    }

    await document.save()
  }

  async delete_file(absolute_path: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(absolute_path), {
      recursive: false,
      useTrash: true
    })
  }

  async rename_file(
    from_absolute_path: string,
    to_absolute_path: string
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(
      vscode.Uri.file(from_absolute_path),
      vscode.Uri.file(to_absolute_path),
      { overwrite: true }
    )
    const applied = await vscode.workspace.applyEdit(edit)
    if (!applied) {
      throw new Error(`Could not rename ${from_absolute_path}`)
    }
  }

  async exists(absolute_path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(absolute_path))
      return true
    } catch {
      return false
    }
  }

  async list_workspace_files(root: WorkspaceRoot): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root.path, '**/*'),
      '**/{node_modules,.git,dist,build,target,vendor,.venv}/{**,*}',
      10000
    )
    return uris.map((uri) =>
      vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')
    )
  }

  async get_selected_files(): Promise<string[]> {
    return this.get_selected_files_callback()
  }

  async confirm_changes(params: {
    changes: ProposedChange[]
    instructions?: string
  }): Promise<string[] | null> {
    const accepted: string[] = []

    for (const change of params.changes) {
      const key = `${change.id}`
      const left = make_diff_uri(`${key}?original`, change.content)
      const right = make_diff_uri(`${key}?proposed`, change.proposed_content)

      await vscode.commands.executeCommand(
        'vscode.diff',
        left,
        right,
        `${change.file_path} (original ↔ proposed)`
      )

      const choice = await vscode.window.showInformationMessage(
        `Apply changes to ${change.file_path}?`,
        'Apply',
        'Skip',
        'Cancel all'
      )

      if (choice === 'Cancel all') return null
      if (choice === 'Skip') continue
      accepted.push(change.id)
    }

    return accepted
  }

  info(message: string): void {
    vscode.window.showInformationMessage(message)
  }

  error(message: string): void {
    vscode.window.showErrorMessage(message)
  }

  async persist_states(states: OriginalFileState[]): Promise<void> {
    await this.context.workspaceState.update(STATE_KEY, states)
  }

  async load_states(): Promise<OriginalFileState[]> {
    return this.context.workspaceState.get<OriginalFileState[]>(STATE_KEY) ?? []
  }

  async apply(params: {
    response: string
    instructions?: string
    preview?: boolean
  }) {
    const result = await apply_response_core({ host: this, options: params })
    await this.persist_states(to_original_states(result.applied))
    return result
  }

  async revert(): Promise<{ reverted: string[]; failed: unknown[] }> {
    const states = await this.load_states()
    const result = await revert_changes_core({ host: this, states })
    await this.persist_states([])
    return result
  }
}
