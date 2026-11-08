import type { Host, WorkspaceRoot } from '../host'
import {
  parse_response,
  DiffItem,
  FileItem,
  ResponseItem
} from '../response-parser/response-parser'
import { resolve_safe_path } from '../utils/safe-path'
import { compute_proposed_content, detect_strategy } from './strategies'
import type { ApplyResult, ProposedChange, OriginalFileState } from '../types'

export type ApplyOptions = {
  response: string
  instructions?: string
  /** Ask the host to show diffs and let the user accept/reject per file. */
  preview?: boolean
  /** Workspace file list used by the intelligent-search parser. */
  workspace_files?: string[]
}

const find_root = (
  roots: WorkspaceRoot[],
  workspace_name?: string
): WorkspaceRoot | undefined => {
  if (workspace_name) {
    const named = roots.find((r) => r.name === workspace_name)
    if (named) return named
  }
  return roots.find((r) => r.name === workspace_name) ?? roots[0]
}

const make_id = (workspace_name: string | undefined, file_path: string) =>
  `${workspace_name ?? ''}:${file_path}`

/**
 * Turns a chat response into proposed changes without touching the disk.
 */
export const plan_changes = async (params: {
  host: Host
  roots: WorkspaceRoot[]
  items: ResponseItem[]
  strategy_hint?: 'auto' | (string & {})
}): Promise<{
  changes: ProposedChange[]
  strategy: ReturnType<typeof detect_strategy> | null
  error?: string
}> => {
  const { host, roots, items } = params

  const file_items = items.filter((i): i is FileItem => i.type === 'file')
  const diff_items = items.filter((i): i is DiffItem => i.type === 'diff')

  if (file_items.length === 0 && diff_items.length === 0) {
    return {
      changes: [],
      strategy: null,
      error: get_unsupported_reason(items)
    }
  }

  const strategy = detect_strategy({ file_items, diff_items })
  const changes: ProposedChange[] = []

  for (const item of file_items) {
    const root = find_root(roots, item.workspace_name)
    if (!root) continue

    const absolute_path = resolve_safe_path(root.path, item.file_path)
    if (!absolute_path) continue

    const exists = await host.exists(absolute_path)
    const original_content = exists
      ? ((await host.read_file(absolute_path)) ?? '')
      : ''

    let proposed_content = ''
    let kind: ProposedChange['kind'] = exists ? 'update' : 'create'

    if (item.is_deleted) {
      kind = 'delete'
    } else if (item.renamed_from) {
      kind = 'rename'
    }

    if (kind !== 'delete') {
      try {
        proposed_content = compute_proposed_content({
          strategy,
          content: item.content,
          original_content
        })
      } catch {
        proposed_content = original_content
      }
    }

    changes.push({
      id: make_id(item.workspace_name, item.file_path),
      kind,
      file_path: item.file_path,
      workspace_name: item.workspace_name,
      content: original_content,
      proposed_content,
      ai_content: item.content,
      file_state: kind === 'create' ? 'new' : undefined,
      file_path_to_restore: item.renamed_from,
      restore_workspace_name: item.renamed_from_workspace,
      is_pure_rename: kind === 'rename' && item.content.trim() === '',
      absolute_path
    })
  }

  for (const item of diff_items) {
    const root = find_root(roots, item.workspace_name)
    if (!root) continue

    const absolute_path = resolve_safe_path(root.path, item.file_path)
    if (!absolute_path) continue

    const exists = await host.exists(absolute_path)
    const original_content = exists
      ? ((await host.read_file(absolute_path)) ?? '')
      : ''

    let proposed_content = original_content
    let apply_failed = false
    try {
      proposed_content = compute_proposed_content({
        strategy: 'diff',
        content: item.content,
        original_content
      })
    } catch {
      apply_failed = true
    }

    changes.push({
      id: make_id(item.workspace_name, item.file_path),
      kind: exists ? 'update' : 'create',
      file_path: item.file_path,
      workspace_name: item.workspace_name,
      content: original_content,
      proposed_content,
      ai_content: item.content,
      file_state: exists ? undefined : 'new',
      apply_failed,
      absolute_path
    })
  }

  return { changes, strategy }
}

const get_unsupported_reason = (items: ResponseItem[]): string => {
  if (items.some((i) => i.type === 'commit-message')) {
    return 'The response is a commit message, not a file change.'
  }
  if (items.some((i) => i.type === 'intelligent-file-search-results')) {
    return 'The response is an intelligent file search result, not a file change.'
  }
  if (items.some((i) => i.type === 'code-at-cursor')) {
    return 'The response is a code-at-cursor completion, not a file change.'
  }
  if (items.some((i) => i.type === 'patch-repair')) {
    return 'Patch repair responses are not handled by this client yet.'
  }
  return 'No applicable file changes were found in the response.'
}

/**
 * Parses a response, shows the diff (when the host supports it), then applies
 * the accepted changes. Nothing is written when the plan is cancelled.
 */
export const apply_response = async (params: {
  host: Host
  options: ApplyOptions
}): Promise<ApplyResult> => {
  const { host, options } = params

  const roots = await host.get_workspace_roots()
  if (roots.length === 0) {
    return {
      applied: [],
      rejected: [],
      strategy: null,
      error: 'No workspace folder is open.'
    }
  }

  const workspace_files =
    options.workspace_files ?? (await host.list_workspace_files(roots[0]))

  const items = parse_response({
    response: options.response,
    is_single_root_folder_workspace: roots.length <= 1,
    workspace_files
  })

  const plan = await plan_changes({ host, roots, items })

  if (plan.error && plan.changes.length === 0) {
    return { applied: [], rejected: [], strategy: null, error: plan.error }
  }

  let accepted: ProposedChange[] = plan.changes

  if (options.preview && host.confirm_changes) {
    const accepted_ids = await host.confirm_changes({
      changes: plan.changes,
      instructions: options.instructions
    })

    if (accepted_ids === null) {
      return {
        applied: [],
        rejected: plan.changes,
        strategy: plan.strategy
      }
    }

    accepted = plan.changes.filter((c) => accepted_ids.includes(c.id))
  }

  const applied: ProposedChange[] = []
  const rejected = plan.changes.filter((c) => !accepted.includes(c))

  for (const change of accepted) {
    try {
      if (change.kind === 'delete') {
        if (await host.exists(change.absolute_path)) {
          await host.delete_file(change.absolute_path)
        }
      } else if (change.kind === 'rename' && change.file_path_to_restore) {
        const restore_root = find_root(roots, change.restore_workspace_name)
        const restore_path = restore_root
          ? resolve_safe_path(restore_root.path, change.file_path_to_restore)
          : null

        if (restore_path && (await host.exists(restore_path))) {
          await host.rename_file(restore_path, change.absolute_path)
        }
        if (!change.is_pure_rename) {
          await host.write_file(change.absolute_path, change.proposed_content)
        }
      } else {
        await host.write_file(change.absolute_path, change.proposed_content)
      }

      applied.push(change)
    } catch (error) {
      host.error(
        `Failed to apply ${change.file_path}: ${(error as Error).message}`
      )
      rejected.push(change)
    }
  }

  return { applied, rejected, strategy: plan.strategy }
}

/** What the host should persist so `revert_changes` can undo the apply. */
export const to_original_states = (
  changes: ProposedChange[]
): OriginalFileState[] =>
  changes.map((change) => ({
    file_path: change.file_path,
    content: change.content,
    workspace_name: change.workspace_name,
    file_state: change.file_state,
    file_path_to_restore: change.file_path_to_restore,
    restore_workspace_name: change.restore_workspace_name,
    is_pure_rename: change.is_pure_rename,
    ai_content: change.ai_content,
    proposed_content: change.proposed_content,
    apply_failed: change.apply_failed
  }))
