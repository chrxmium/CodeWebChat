import { PromptBuilder } from './prompt-builder'
import {
  EDIT_FORMAT_INSTRUCTIONS_DIFF,
  EDIT_FORMAT_INSTRUCTIONS_SEARCH_REPLACE,
  EDIT_FORMAT_INSTRUCTIONS_TRUNCATED,
  EDIT_FORMAT_INSTRUCTIONS_WHOLE
} from './edit-format-instructions'
import type { EditFormat } from '../types'

export type ContextFile = {
  /** Path shown to the model (already relative to the workspace). */
  path: string
  content?: string
  is_binary?: boolean
  modified_at?: number
}

export type BuildPromptParams = {
  files: ContextFile[]
  instructions: string
  completed_tasks?: string[]
  skill_definitions?: string
  accuracy_boost?: boolean
  /** Edit-format instructions are only appended for editing prompts. */
  prompt_type?: 'ask' | 'edit'
  edit_format?: EditFormat
  now?: number
}

export const EDIT_FORMAT_INSTRUCTIONS: Record<EditFormat, string> = {
  whole: EDIT_FORMAT_INSTRUCTIONS_WHOLE,
  truncated: EDIT_FORMAT_INSTRUCTIONS_TRUNCATED,
  'search-replace': EDIT_FORMAT_INSTRUCTIONS_SEARCH_REPLACE,
  diff: EDIT_FORMAT_INSTRUCTIONS_DIFF
}

const RECENT_WINDOW_MS = 1.5 * 60 * 60 * 1000

/**
 * Splits context files the way the editor does for prompt caching: files that
 * changed in the last 1.5 hours go last, everything else keeps a stable order.
 */
export const split_context_files = (params: {
  files: ContextFile[]
  now?: number
}): { other_files: ContextFile[]; recent_files: ContextFile[] } => {
  const now = params.now ?? Date.now()
  const other_files: ContextFile[] = []
  const recent_files: ContextFile[] = []

  for (const file of params.files) {
    if (
      typeof file.modified_at === 'number' &&
      now - file.modified_at < RECENT_WINDOW_MS
    ) {
      recent_files.push(file)
    } else {
      other_files.push(file)
    }
  }

  recent_files.sort((a, b) => (a.modified_at ?? 0) - (b.modified_at ?? 0))

  return { other_files, recent_files }
}

export const build_files_context = (files: ContextFile[]): string =>
  files
    .map((file) =>
      PromptBuilder.build_file_context({
        filepath: file.path,
        content: file.content,
        is_binary: file.is_binary
      })
    )
    .join('')

/**
 * Builds the full markdown prompt that is autofilled into a chatbot.
 * Mirrors the VS Code extension: `# Files`, output formatting (edit format),
 * completed tasks, then `# Task` with the user instructions.
 */
export const build_chatbot_prompt = (
  params: BuildPromptParams
): { text: string; prompt_part1: string; prompt_part2: string } => {
  const { other_files, recent_files } = split_context_files({
    files: params.files,
    now: params.now
  })

  const other_context = build_files_context(other_files)
  const recent_context = build_files_context(recent_files)

  const is_edit = params.prompt_type === 'edit'
  const output_formatting =
    is_edit && params.edit_format
      ? EDIT_FORMAT_INSTRUCTIONS[params.edit_format]
      : undefined

  const { part1, part2, full_prompt } = PromptBuilder.build_prompt({
    files_context_part1: other_context,
    files_context_part2: recent_context,
    skill_definitions: params.skill_definitions,
    output_formatting,
    requirements: undefined,
    completed_tasks: is_edit ? params.completed_tasks : undefined,
    user_instructions: params.instructions,
    accuracy_boost: params.accuracy_boost
  })

  return { text: full_prompt.trim(), prompt_part1: part1, prompt_part2: part2 }
}
