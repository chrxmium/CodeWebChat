import { apply_response, to_original_states } from './apply-response'
import { revert_changes } from './revert'
import type { Host, WorkspaceRoot } from '../host'
import type { ProposedChange } from '../types'

const create_memory_host = (
  files: Record<string, string>,
  options?: { accept_all?: boolean; cancel?: boolean }
) => {
  const root: WorkspaceRoot = { name: 'demo', path: '/ws' }
  const state: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    state[`/ws/${path}`] = content
  }
  const abs = (p: string) => `/ws/${p}`

  const host: Host = {
    get_workspace_roots: async () => [root],
    read_file: async (p) => (p in state ? state[p] : null),
    write_file: async (p, content) => {
      state[p] = content
    },
    delete_file: async (p) => {
      delete state[p]
    },
    rename_file: async (from, to) => {
      state[to] = state[from]
      delete state[from]
    },
    exists: async (p) => p in state,
    list_workspace_files: async () =>
      Object.keys(state).map((p) => p.replace('/ws/', '')),
    get_selected_files: async () => [],
    confirm_changes: async ({ changes }: { changes: ProposedChange[] }) => {
      if (options?.cancel) return null
      const accepted =
        options?.accept_all === false ? changes.slice(0, 1) : changes
      return accepted.map((c) => c.id)
    },
    info: () => {},
    error: () => {}
  }

  return { host, state, abs }
}

describe('apply_response', () => {
  it('applies whole-file edits and records the original content', async () => {
    const { host, state, abs } = create_memory_host({
      'src/hello.ts': 'export const a = 1\n'
    })

    const result = await apply_response({
      host,
      options: {
        response: [
          'Updated the greeting.',
          '',
          '### Updated file: `src/hello.ts`',
          '',
          '```typescript',
          'export const a = 2',
          '```'
        ].join('\n')
      }
    })

    expect(result.error).toBeUndefined()
    expect(result.strategy).toBe('whole')
    expect(result.applied).toHaveLength(1)
    expect(state[abs('src/hello.ts')]).toBe('export const a = 2\n')

    const states = to_original_states(result.applied)
    expect(states[0].content).toBe('export const a = 1\n')
  })

  it('repairs truncated blocks from the original file', async () => {
    const original = [
      'function a() {',
      '  return 1',
      '}',
      '',
      'function b() {',
      '  return 2',
      '}'
    ].join('\n')

    const { host, state, abs } = create_memory_host({
      'src/x.ts': original
    })

    await apply_response({
      host,
      options: {
        response: [
          '### Updated file: `src/x.ts`',
          '',
          '```typescript',
          'function a() {',
          '  return 42',
          '}',
          '',
          '// ...',
          '```'
        ].join('\n')
      }
    })

    expect(state[abs('src/x.ts')]).toBe(
      [
        'function a() {',
        '  return 42',
        '}',
        '',
        'function b() {',
        '  return 2',
        '}'
      ].join('\n')
    )
  })

  it('applies conflict-marker (search/replace) edits', async () => {
    const { host, state, abs } = create_memory_host({
      'src/y.ts': 'const a = 1\nconst b = 2\n'
    })

    await apply_response({
      host,
      options: {
        response: [
          '### Updated file: `src/y.ts`',
          '',
          '```typescript',
          '<<<<<<< SEARCH',
          'const a = 1',
          '=======',
          'const a = 10',
          '>>>>>>> REPLACE',
          '```'
        ].join('\n')
      }
    })

    expect(state[abs('src/y.ts')]).toBe('const a = 10\nconst b = 2\n')
  })

  it('creates and deletes files', async () => {
    const { host, state, abs } = create_memory_host({
      'gone.ts': 'bye\n'
    })

    await apply_response({
      host,
      options: {
        response: [
          '### New file: `new/created.ts`',
          '',
          '```typescript',
          'export const n = 1',
          '```',
          '',
          '### Deleted file: `gone.ts`'
        ].join('\n')
      }
    })

    expect(state[abs('new/created.ts')]).toBe('export const n = 1')
    expect(state[abs('gone.ts')]).toBeUndefined()
  })

  it('does nothing when the user cancels the preview', async () => {
    const { host, state, abs } = create_memory_host(
      { 'src/a.ts': 'old\n' },
      { cancel: true }
    )

    const result = await apply_response({
      host,
      options: {
        preview: true,
        response: [
          '### Updated file: `src/a.ts`',
          '',
          '```ts',
          'new',
          '```'
        ].join('\n')
      }
    })

    expect(result.applied).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(state[abs('src/a.ts')]).toBe('old\n')
  })

  it('refuses path traversal', async () => {
    const { host, state } = create_memory_host({})

    const result = await apply_response({
      host,
      options: {
        response: [
          '### Updated file: `../../etc/passwd`',
          '',
          '```',
          'x',
          '```'
        ].join('\n')
      }
    })

    expect(result.applied).toHaveLength(0)
    expect(Object.keys(state)).toHaveLength(0)
  })

  it('reports non-file responses', async () => {
    const { host } = create_memory_host({})

    const result = await apply_response({
      host,
      options: { response: '**Commit message:** Bump version' }
    })

    expect(result.error).toContain('commit message')
  })
})

describe('revert_changes', () => {
  it('restores edited files and deletes created ones', async () => {
    const { host, state, abs } = create_memory_host({
      'src/keep.ts': 'before\n'
    })

    const applied = await apply_response({
      host,
      options: {
        response: [
          '### Updated file: `src/keep.ts`',
          '',
          '```ts',
          'after',
          '```',
          '',
          '### New file: `src/added.ts`',
          '',
          '```ts',
          'added',
          '```'
        ].join('\n')
      }
    })

    expect(state[abs('src/keep.ts')]).toBe('after\n')
    expect(state[abs('src/added.ts')]).toBe('added')

    const result = await revert_changes({
      host,
      states: to_original_states(applied.applied)
    })

    expect(result.failed).toHaveLength(0)
    expect(state[abs('src/keep.ts')]).toBe('before\n')
    expect(state[abs('src/added.ts')]).toBeUndefined()
  })
})
