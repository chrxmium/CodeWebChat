export type EditFormat = 'whole' | 'truncated' | 'search-replace' | 'diff'

/**
 * Bookkeeping record for a file touched by an apply. `content` is always the
 * ORIGINAL content, so the record alone is enough to revert.
 */
export type OriginalFileState = {
  file_path: string
  content: string
  workspace_name?: string
  cursor_offset?: number
  new_file_path?: string
  new_workspace_name?: string
  file_path_to_restore?: string
  restore_workspace_name?: string
  file_state?: 'new' | 'deleted'
  ai_content?: string
  proposed_content?: string
  is_pure_rename?: boolean
  apply_failed?: boolean
}

export type ChangeKind = 'create' | 'update' | 'delete' | 'rename'

export type ProposedChange = OriginalFileState & {
  kind: ChangeKind
  proposed_content: string
  absolute_path: string
  /** Stable id used to report accept/reject decisions back from the host. */
  id: string
}

export type ApplyStrategy = 'whole' | 'truncated' | 'search-replace' | 'diff'

export type ApplyResult = {
  applied: ProposedChange[]
  rejected: ProposedChange[]
  strategy: ApplyStrategy | null
  /** Set when the response did not contain anything applicable. */
  error?: string
}
