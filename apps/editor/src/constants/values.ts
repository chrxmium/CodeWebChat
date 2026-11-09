export const CHECKPOINT_LIFESPAN = 7 * 24 * 60 * 60 * 1000 // 7 days
export const PROMPT_UPLOADS_LIFESPAN = 15552000000 // 6 months
export const MAX_FILE_TOKENS_FOR_COMMIT_MESSAGE = 20000
export const MAX_PROMPT_CHARS_IN_COMMIT_MESSAGE = 1000
export const GIT_LOG_SINCE_DURATION = '6 months ago'
export const SYMBOL_CACHE_DURATION = 5 * 60 * 1000
export const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes
export const MINIMUM_WAIT_TIME = 1500

export const DIFF_PLACEHOLDERS = {
  FILE_CREATED: 'File created',
  FILE_DELETED: 'File deleted',
  FILE_RENAMED: 'File renamed',
  FILE_MODIFIED: 'File modified',
  BINARY_FILE_CREATED: 'Binary file created',
  BINARY_FILE_DELETED: 'Binary file deleted',
  BINARY_FILE_MODIFIED: 'Binary file modified',
  BINARY_FILE_ADDED: 'Binary file added'
}
