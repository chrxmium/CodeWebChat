# @cwc/core

Editor-independent core of Code Web Chat. This package contains no `vscode`
imports and no editor SDK of any kind, so it can run in the VS Code extension,
in the Node sidecar and in tests without an editor present.

Moved here verbatim from `apps/editor` in Phase 1:

- `prompt/` — prompt assembly (`PromptBuilder`), edit-format instructions,
  prompt instruction constants, chatbot prompt builder.
- `response-parser/` — parsers for whole files, diffs, patch repair,
  code-at-cursor, commit messages and intelligent search results (with their
  test cases).
- `changes/` — the diff applier, the truncation (ellipsis) repair and the
  search/replace (conflict marker) applier (with their test cases).
- `utils/` — path normalisation, markdown fencing, path safety, response cleanup.

Added here:

- `host.ts` — the `Host` interface every editor implements (workspace roots,
  file I/O, context selection, diff preview, UI messages).
- `apply/` — host-driven `apply_response` (parse → plan → preview → write) and
  `revert_changes`, keeping the editor's `OriginalFileState` bookkeeping.

`apps/editor` keeps thin re-export shims at the old paths, so existing imports
and tests keep working while the upstream VS Code behaviour is unchanged.

This package is part of an unofficial fork of
[robertpiosik/CodeWebChat](https://github.com/CodeWebChat/CWC) by Robert Piosik,
which is where all of this logic originates. See `NOTICE.md` at the repo root.
