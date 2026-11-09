import * as path from 'path'
import { normalize_path } from './normalize-path'

const FORBIDDEN_PREFIXES = [
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'dist',
  'build',
  'target',
  'bin',
  'obj'
]

/**
 * Resolves a model-supplied path inside a workspace root and refuses anything
 * that escapes it (traversal, absolute paths, `.git`, generated folders).
 * Returns null when the path is not safe to touch.
 */
export const resolve_safe_path = (
  workspace_root: string,
  relative_path: string
): string | null => {
  const normalized = normalize_path(relative_path).replace(/^\/+/, '')

  if (!normalized || normalized.includes('\0')) return null
  if (normalized.split('/').includes('..')) return null
  if (path.isAbsolute(normalized)) return null

  const first_segment = normalized.split('/')[0].toLowerCase()
  if (FORBIDDEN_PREFIXES.includes(first_segment)) return null

  const root = path.resolve(workspace_root)
  const resolved = path.resolve(root, normalized)

  const root_with_sep = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(root_with_sep)) return null

  return resolved
}
