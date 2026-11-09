import { apply_diff } from '../changes/diff-processor'
import { process_truncations } from '../changes/truncations-processor'
import { is_truncation_line } from '../changes/truncations-processor/utils/is-truncation-line'
import { apply_search_replace_to_content } from '../changes/search-replace-processor/apply-search-replace-to-content'
import { parse_search_replace_segments } from '../changes/search-replace-processor/parse-search-replace-segments'
import type { DiffItem, FileItem } from '../response-parser/response-parser'
import type { ApplyStrategy } from '../types'

export const preserve_trailing_newline = (
  original_content: string,
  new_content: string
): string => {
  if (original_content.endsWith('\n') && !new_content.endsWith('\n')) {
    return new_content + '\n'
  }
  return new_content
}

export const has_conflict_markers = (content: string): boolean =>
  content.includes('<<<<<<<') &&
  content.includes('=======') &&
  content.includes('>>>>>>>')

export const has_truncation_markers = (content: string): boolean =>
  content.split('\n').some((line) => is_truncation_line(line))

/** Mirrors the editor's apply-time strategy detection. */
export const detect_strategy = (params: {
  file_items: FileItem[]
  diff_items: DiffItem[]
}): ApplyStrategy => {
  if (params.diff_items.length > 0) return 'diff'
  if (params.file_items.some((f) => has_conflict_markers(f.content))) {
    return 'search-replace'
  }
  if (params.file_items.some((f) => has_truncation_markers(f.content))) {
    return 'truncated'
  }
  return 'whole'
}

export const compute_proposed_content = (params: {
  strategy: ApplyStrategy
  content: string
  original_content: string
}): string => {
  const { strategy, content, original_content } = params

  if (strategy === 'truncated') {
    return process_truncations(content, original_content)
  }

  if (strategy === 'search-replace') {
    if (has_conflict_markers(content)) {
      return apply_search_replace_to_content({
        original_content,
        segments: parse_search_replace_segments(content)
      })
    }
    return preserve_trailing_newline(original_content, content)
  }

  if (strategy === 'diff') {
    return apply_diff({
      original_code: original_content,
      diff_patch: content
    })
  }

  return preserve_trailing_newline(original_content, content)
}
