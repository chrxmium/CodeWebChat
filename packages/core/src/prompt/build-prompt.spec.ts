import { build_chatbot_prompt, split_context_files } from './build-prompt'
import { EDIT_FORMAT_INSTRUCTIONS_TRUNCATED } from './edit-format-instructions'

describe('build_chatbot_prompt', () => {
  it('puts unchanged files first, recent files after and instructions last', () => {
    const now = 1_000_000_000
    const { text } = build_chatbot_prompt({
      now,
      instructions: 'Add a greet function.',
      prompt_type: 'edit',
      edit_format: 'truncated',
      files: [
        {
          path: 'src/recent.ts',
          content: 'recent',
          modified_at: now - 1000
        },
        { path: 'src/old.ts', content: 'old' }
      ]
    })

    const old_index = text.indexOf('### File: `src/old.ts`')
    const recent_index = text.indexOf('### File: `src/recent.ts`')
    const task_index = text.indexOf('# Task')

    expect(old_index).toBeGreaterThan(-1)
    expect(recent_index).toBeGreaterThan(old_index)
    expect(task_index).toBeGreaterThan(recent_index)
    expect(text.indexOf('Add a greet function.')).toBeGreaterThan(task_index)
    expect(text).toContain('# Files')
  })

  it('appends edit-format instructions only for editing prompts', () => {
    const files = [{ path: 'a.ts', content: 'a' }]

    const edit = build_chatbot_prompt({
      files,
      instructions: 'do it',
      prompt_type: 'edit',
      edit_format: 'truncated'
    })

    const ask = build_chatbot_prompt({
      files,
      instructions: 'explain it',
      prompt_type: 'ask'
    })

    expect(edit.text).toContain(
      EDIT_FORMAT_INSTRUCTIONS_TRUNCATED.split('\n')[0]
    )
    expect(ask.text).not.toContain('ellipsis comments')
  })

  it('renders binary files without content', () => {
    const { text } = build_chatbot_prompt({
      files: [{ path: 'logo.png', is_binary: true }],
      instructions: 'look'
    })

    expect(text).toContain('### File: `logo.png`')
    expect(text).toContain('Binary file')
  })
})

describe('split_context_files', () => {
  it('treats files modified within 1.5 hours as recent', () => {
    const now = 10_000_000
    const { other_files, recent_files } = split_context_files({
      now,
      files: [
        { path: 'a', modified_at: now - 60_000 },
        { path: 'b', modified_at: now - 60 * 60 * 1000 * 2 }
      ]
    })

    expect(other_files.map((f) => f.path)).toEqual(['b'])
    expect(recent_files.map((f) => f.path)).toEqual(['a'])
  })
})
