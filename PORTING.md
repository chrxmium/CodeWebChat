# Porting audit — Code Web Chat to JetBrains + Firefox

Phase 0 of the port. Findings only, plus the attribution files (`NOTICE.md`, README
section). No behavioural code was changed in this phase.

Audited at commit `2b1f02eab` (`main`, 8 Nov 2026).

---

## 1. Licence status

### At HEAD

| Path                             | Content                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/editor/LICENSE`            | `Copyright © 2026 Robert Piosik` — the only licence file in the tree                  |
| `LICENSE` (repo root)            | **absent**                                                                            |
| `apps/browser/LICENSE`           | **absent**                                                                            |
| `packages/*/LICENSE`             | **absent**                                                                            |
| every `package.json`             | **no `license` field** (`grep -rn '"license"' --include=package.json .` → no matches) |
| `apps/browser/src/manifest.json` | no licence field (`author: Robert Piosik`)                                            |

So HEAD carries an all-rights-reserved copyright line and no open-source grant. The
README does not describe the project as open source.

### In git history

```
$ git log --all --oneline -- 'LICENSE*'
818e5fb95 Remove LICENSE file and update README to remove open-source references
d3ab66322 Change the project license to GNU General Public License Version 3
d72a6ae49 Update the project license to Apache 2.0
503421510 ...
7be950552 ...
9be6c4384 ...
5d4789f23 ...

$ git log --all --name-only --pretty=format: -- '*LICENSE*' | sort -u
LICENSE
apps/browser/LICENSE
apps/editor/LICENSE
docs/LICENSE
packages/browser/LICENSE
packages/docs/LICENSE
packages/vscode/LICENSE
packages/website/LICENSE
```

Timeline: Apache-2.0 → GPL-3.0 → GPL-3.0 file resized → licence removed
(`818e5fb95` deletes a 674-line `LICENSE` and edits the README). The tree lived under
Apache-2.0 and GPL-3.0 at earlier commits, under differently named per-package licence
files before the monorepo reorganisation.

**Reported, not acted on.** No upstream notice was removed, altered or relicensed by
this fork. `NOTICE.md` records the state and warns redistributors. This is a legal risk
the project owner must resolve with the copyright holder before publishing anything
(the JetBrains Marketplace, AMO, or a release archive); it is not a technical blocker
for the port.

---

## 2. Repository map

pnpm workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`), TypeScript everywhere,
Vite (rolldown) for bundling the extension/webviews, Jest + ts-jest for tests.

| Area                          | Path              | Files         | Role                                                                                                                                                                                          |
| ----------------------------- | ----------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code extension             | `apps/editor`     | 1111          | The editor product. Package `gemini-coder`, display name "Code Web Chat", `publisher: robertpiosik`. Hosts the webview UI, commands, apply pipeline, and spawns the WebSocket server process. |
| Connector (browser extension) | `apps/browser`    | 61            | MV3 Chrome extension ("Autofill for Code Web Chat"). Background service worker owns the WebSocket; content scripts autofill prompts and inject the _Apply Response_ button.                   |
| Website                       | `apps/web`        | 12            | Next.js marketing site (`codeweb.chat`). Out of scope.                                                                                                                                        |
| Shared types/utilities        | `packages/shared` | 23            | `constants/websocket.ts`, `constants/chatbots.ts`, `types/websocket-message.ts`, logger, prompt-symbol helpers. Imported by **both** editor and browser via the `@shared` alias.              |
| UI kit                        | `packages/ui`     | 293           | React components/styles for the editor webviews and Storybook. Out of scope.                                                                                                                  |
| Tests                         | —                 | 13 spec files | `jest.config.js` at the root runs `apps/editor` (own config) plus `packages/shared`.                                                                                                          |

Entry points:

- editor: `apps/editor/src/extension.ts` → `activate()`, builds `out/extension.js` and
  `out/websocket-server-process.js` (`apps/editor/vite.config.ts`).
- browser: `apps/browser/src/background/main.ts` (service worker),
  `…/send-prompt-content-script/send-prompt-content-script.ts` (content script),
  `src/views/popup/App.tsx` (popup).

### Naming note for later phases

The mission says `apps/vscode`. The VS Code app is `apps/editor`; renaming it would
invalidate every path, script and the `.vscodeignore`/`vsce` packaging, so the fork keeps
`apps/editor` and treats it as "the VS Code app". New apps are `apps/jetbrains`,
`apps/sidecar`; the new shared package is `packages/core`.

---

## 3. Editor ↔ browser protocol

### Transport and port

- Local TCP WebSocket (`ws`), **127.0.0.1 only**, default port **55155**
  (`packages/shared/src/constants/websocket.ts`):

  ```ts
  export const DEFAULT_PORT = 55155
  export const CLIENT_TYPE = { BROWSER: 'browser', EDITOR: 'editor' }
  ```

- The server is a **separate detached Node process** spawned by the extension
  (`apps/editor/src/services/websocket-server-process.ts`, started from
  `websocket-manager.ts` via `child_process.spawn(process.execPath, [server_script_path], { detached: true, stdio: 'ignore', env: { …ELECTRON_RUN_AS_NODE: '1' } })`).
- Remote/SSH workspaces: the editor forwards the port and the browser may connect to
  additional ports. The editor pushes its list with a `forwarded-ports` message; the
  browser stores the union and dials every port (`apps/browser/src/background/websocket.ts`,
  `ports_to_check()` → `[DEFAULT_PORT, ...forwarded_ports]`).
- `maxPayload: 10 * 1024 * 1024`. Ping every 10 s; a client that misses one ping is
  terminated. The server exits 10 s after the last editor client disconnects.

### Handshake

Both ends are WebSocket **clients of the same server**; the server routes messages. The
client role is chosen by query parameter `?client_type=browser|editor`.

Browser connect URL (browser → server):

```ts
let ws_url = `ws://localhost:${port}?client_type=${CLIENT_TYPE.BROWSER}&version=${version}&user_agent=${encodeURIComponent(user_agent)}&browser_id=${encodeURIComponent(browser_id)}`
if (profile_name) ws_url += `&profile_name=${encodeURIComponent(profile_name)}`
```

Editor connect URL (editor → server), with a bearer token:

```ts
const ws_url = `ws://localhost:${this.port}?client_type=${CLIENT_TYPE.EDITOR}`
this.client = new WebSocket.WebSocket(ws_url, {
  headers: { Authorization: `Bearer ${token}` }
})
```

`browser_id` is a persistent `crypto.randomUUID()` kept in `browser.storage.local`, which
is how the editor addresses a specific browser profile.

Server-side flow after connect:

1. browser: registered in `browser_clients`, `browser-connection-status` broadcast to all
   editors, then `{ action: 'connected', id }` to that browser; every editor receives
   `vscode-client-connected` (browser side uses it for port bookkeeping).
2. editor: assigned `{ action: 'client-id-assignment', client_id }`, then sent
   `browser-connection-status` with the connected browser list.
3. On editor disconnect the browser receives `vscode-client-disconnected`.

### Authentication

Three separate mechanisms, all enforced in `verifyClient` of the server:

1. **Editor → server:** shared file token.
   `apps/editor/src/utils/shared-token.ts` creates `~/.cwc/.websocket-token`
   (32 random bytes hex, dir `0700`, file `0600`) and both the extension and the spawned
   server read it. Missing/mismatched `Authorization: Bearer …` → `401`.
2. **Server identity → editor:** `/health?challenge=…` returns an
   `HMAC-SHA256(token, challenge)` signature, so the extension only trusts a process that
   can read the token file (`_wait_for_server_ready`). The same check is used before
   attaching to a port that is already in use.
3. **Browser → server:** WebSocket `Origin` allow-list — nothing else:

   ```ts
   if (origin === 'chrome-extension://ljookipcanaglfaocjbgdicfbdhhjffp')
     return cb(true)
   if (
     process.env.DEV_CHROME_EXTENSION_ID &&
     origin == `chrome-extension://${process.env.DEV_CHROME_EXTENSION_ID}`
   )
     return cb(true)
   // Firefox: Wildcard fallback (Firefox extensions get random origins, making exact matches impossible)
   if (origin && origin.startsWith('moz-extension://')) return cb(true)
   return cb(false, 403, 'Forbidden: Invalid Origin')
   ```

   A Firefox extension is therefore **already accepted** by the server. There is no
   browser-side token; the security boundary is "local process + the extension's origin".

### Message schema

Canonical definitions: `packages/shared/src/types/websocket-message.ts` (shared by both
apps, so no drift is possible).

| `action`                                                 | Direction                  | Payload (beyond `action`)                                                                                                                                                               |
| -------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize-chat`                                        | editor → server → browser  | `text`, `url`, `client_id`, `chatbot?`, `model?`, `target_browser_id?`, `reasoning_effort?`, `system_instructions?`, `options?[]`, `raw_instructions?`, `inject_apply_response_button?` |
| `apply-response`                                         | browser → server → editor  | `client_id`, `raw_instructions?`, `web_configuration_details? {chatbot, model?, reasoning_effort?}`                                                                                     |
| `browser-connection-status`                              | server → editor            | `connected_browsers: [{id, version, user_agent, profile_name?}]`                                                                                                                        |
| `client-id-assignment`                                   | server → editor            | `client_id`                                                                                                                                                                             |
| `connected`                                              | server → browser           | `id`                                                                                                                                                                                    |
| `vscode-client-connected` / `vscode-client-disconnected` | server → browser           | `client_id`                                                                                                                                                                             |
| `forwarded-ports`                                        | editor → server → browsers | `ports[]`, plus `client_id` added by the server                                                                                                                                         |
| `ping` / `pong`                                          | both                       | —                                                                                                                                                                                       |

Routing rules in the server (`_handle_message`): `initialize-chat` goes to
`target_browser_id` (or the most recently connected browser); `apply-response` goes to the
editor named by `client_id`; everything else is dropped. The browser keeps a
`client_id → port` map so `apply-response` is returned on the very socket that delivered
the prompt.

`initialize-chat` is also the security boundary on the browser side: the background
script refuses any URL whose hostname is not a known chatbot host
(`handle_initialize_chat_message`, checked against `CHATBOTS[].url` plus `openwebui`).

### "Initialize, never scrape"

The content script fills the composer with the prompt text and never submits it. The
_Apply Response_ button is explicitly an alias for the chatbot's own copy button: it
copies the response to the clipboard and posts `{action:'apply-response'}` to the
background script, and the editor then **reads the clipboard**. Message flow is
one-directional for content — nothing is ever extracted from the DOM and sent back.

---

## 4. `vscode` API surface

`apps/editor/src` has **781 `.ts`/`.tsx` files; 300 of them import `vscode`**; 481 do not.

### Modules that import `vscode` (all VS Code-coupled)

- `extension.ts` (activation), `i18n/index.ts`, all of `commands/**` (except pure
  `index.ts` barrels and `utils/file-checks.ts`, `utils/file-operations/preserve-newline.ts`),
  `context/**` (workspace/open-editors/selected-files providers, token calculator),
  `features/**` (checkpoints, agentic search, context restoration, search-files quick picks),
  `migrations/**`, `services/**` (`websocket-manager`, `providers-manager`,
  `prompt-view-api-calls-manager`, `git-discard-file-watcher`),
  `utils/**` (git, workspace snapshots, quick picks, update checks),
  `views/**` backends and every webview backend message handler.
- Notable: `views/prompt/backend/prompt-view-provider.ts` (~all editor state lives here:
  context, instructions, tasks, web configuration, symbol cache, undo state).

### Modules with **no** `vscode` import (pure logic today)

- `utils/prompt-builder.ts`, `utils/files-collector.ts`, `utils/normalize-path.ts`,
  `utils/get-markdown-backticks.ts`, `utils/natural-sort.ts`, `utils/is-binary.ts`,
  `utils/path-sanitizer.ts`, `utils/extract-paths-from-text/**`,
  `utils/cleanup-api-response/**`, `utils/ascii-tree/**`.
- `utils/changes-integration/**` — the whole apply engine:
  `diff-processor/**` (custom unified-diff applier + spec), `truncations-processor/**`
  (ellipsis repair + spec), `search-replace-processor/**` (conflict-marker applier + spec).
- `commands/apply-response-command/utils/response-parser/**` — every parser and its spec
  (`standard-parser`, `diff-parser`, `patch-repair-parser`, `code-at-cursor-parser`,
  `commit-message-parser`, `intelligent-file-search-results-parser`).
- `constants/edit-format-instructions.ts`, `constants/instructions.ts`,
  `constants/values.ts`, `types/**`.
- `services/websocket-server-process.ts` (Node only; imports `ws`, `http`, `crypto`).
- `packages/shared/**` and `packages/ui/**` (React, no `vscode`).

**Conclusion:** the valuable, hard-to-reproduce logic (prompt assembly, response parsing,
diff/truncation/conflict-marker application, revert bookkeeping) is already free of
`vscode`. What is coupled is orchestration: filesystem writes through `vscode.workspace.fs`,
diff preview (`DiffManager` equivalent), tabs, clipboard, quick picks and `workspaceState`.

---

## 5. Apply pipeline

Entry: `codeWebChat.applyResponse` (`apps/editor/src/commands/apply-response-command/apply-response-command.ts`),
invoked by the command, by the webview history, and by the Connector (via
`WebSocketManager` → `vscode.commands.executeCommand('codeWebChat.applyResponse', {raw_instructions, web_configuration_details})`).
Input is `args.response` or, when absent, **the clipboard**.

1. **Parse** (`parse_response`, `response-parser.ts`) — first match wins:
   commit message → intelligent file search results → code-at-cursor → patch repair → a
   response containing conflict markers / hunk headers / `diff` fences is parsed as
   **diffs** → otherwise **standard file blocks** (`### Updated file: `path``heading +
fenced block; also`### New file:`, `### Deleted file:`, `### Renamed file: `a` (old) `b` (new)`).
2. **Edit format** is not detected at apply time; it is a setting used to _ask_ the model
   for a shape, and the applied strategy is detected from the response
   (`process_response`):
   - `diff` items → `apply_git_patch`: try `git apply --whitespace=fix --ignore-whitespace --recount`
     (strict whitespace for `.py/.yaml/.yml`), else the custom `apply_diff`.
   - file items containing `<<<<<<<` `=======` `>>>>>>>` → **search-replace / conflict
     markers** (`handle_search_replace`).
   - file items containing a truncation line (`// ...`, `/* ... */`, `<!-- ... -->`,
     `# ...`) → **truncated** (`handle_truncated_edit` → `process_truncations`, which
     fills each ellipsis run with the matching original lines).
   - otherwise → **whole / fast replace** (overwrite, preserving a trailing newline).
3. **Safety:** `sanitize_file_name` + `create_safe_path` reject traversal and any `.git`
   segment; excluded top-level folders (`.git`, `node_modules`, `vendor`, `.venv`,
   `dist`, `build`, `target`, `bin`, `obj`) are filtered out of parsed items.
4. **Checkpoint + preview:** a checkpoint is created _before_ files are touched; every
   changed file is opened in a diff (`preview.ts` → `show_diff_with_actions`) where the
   user accepts/rejects per file, can jump between files, and can edit the proposed
   content. Rejected/aborted files are reverted with `undo_files`.
5. **Bookkeeping:** each write pushes an `OriginalFileState`
   (`file_path`, `content` = original text, `workspace_name?`, `file_state: 'new'`,
   `file_path_to_restore` for renames, `ai_content`, `proposed_content`, `cursor_offset`).
   Stored in `workspaceState` (`LAST_APPLIED_CHANGES_*`) by `update_undo_button_state`.
6. **Malformed-diff repair:** when `git apply` and `apply_diff` both fail, or a file was
   only partially applied, the editor builds a **Patch Repair** prompt
   (`patch-repair-handler.ts`, `handle-patch-repair.ts`, `patch_repair_format_instructions`)
   that sends the original file plus the malformed edits, and the user pastes the model's
   full-file rewrite back; a `### Patch repair: `path`` response is written verbatim.
7. **Revert:** `Undo Last Changes` → `handle-undo.ts` → `undo_files`
   (`utils/file-operations/undo-files.ts`): delete files whose state is `new`, move
   renamed files back, recreate deleted files, otherwise restore `state.content` (via an
   editor edit when the file is visible, so IDE undo sees it, else `workspace.fs.writeFile`),
   then clear `LAST_APPLIED_CHANGES_*` and the undo button.

---

## 6. Chatbot-initialization prompts

Handler: `handle_autofill.ts` (web) / `handle-copy-prompt.ts` (clipboard). Both funnel
through `build_prompt_payload.ts` → `FilesCollector.collect_files` →
`PromptBuilder.build_prompt` (`apps/editor/src/utils/prompt-builder.ts`).

1. **Context files.** `FilesCollector` unions selected workspace files, files selected in
   the _Open Editors_ view and additional paths, deduplicates, and splits them into
   `other_files` (older than 1.5 h, ordered by selection timestamp, 20 s bucket + natural
   sort) and `recent_files` (modified within 1.5 h, oldest first). Each becomes:

   ````
   ### File: `relative/path`      (or `workspace/relative/path` in a multi-root workspace)

   ```<fence one backtick longer than any inside>
   <content>
   ````

   ```

   Binary files are rendered as the literal `Binary file`. Ranges (`setRanges`) are
   applied to the content before fencing. Ordering is deliberate for prompt-cache hit
   rates: unchanged files first, recently modified ones after, instructions last.
   ```

2. **Instructions.** The composer text and each completed task go through
   `replace_symbols` (`@` files, `#` snippets/templates/saved contexts/commits/skills,
   website and image symbols); images may be stripped for clipboard/autofill.
3. **Assembly** (`PromptBuilder.build_prompt`): `# Files` section (split into `part1`
   = unchanged files and `part2` = recent files + active file), optional
   skill definitions, `# Output formatting`, `# Requirements`, `# Completed tasks`, then
   `# Task` followed by the user instructions. `full_prompt` is `part1 + part2`; the
   `part1`/`part2` split only matters to API calls, the browser always receives
   `full_prompt`. When "accuracy boost" is on, the task block is _also_ prepended at the
   top so instructions bracket the context (prompt-organization best practice).
4. **Edit-format instructions** (`constants/edit-format-instructions.ts`) are appended
   only in _edit_ mode and only for chatbot targets: `WHOLE` (full file), `TRUNCATED`
   (ellipsis comments), `SEARCH_REPLACE` (conflict markers), `DIFF` (unified diff). Each
   starts from the same `intro` (explanation + `### … file: `path``heading) and one
worked example, so the parser in §5 can find files reliably. Ask/intelligent-search/
patch-repair/commit-message prompts live in`constants/instructions.ts`.
5. **Delivery.** `WebSocketManager.initialize_chat` resolves the chatbot URL (user id and
   model overrides for AI Studio/Gemini/Arena/Open WebUI, same-host URL override guard),
   picks the target browser, and sends `initialize-chat` with `text`, `url`, `chatbot`,
   `model`, `system_instructions`, `options`, `client_id`, `raw_instructions` and
   `inject_apply_response_button: prompt_type === 'edit'`.

---

## 7. Does the Connector already have a Firefox build?

**Yes — a working MV2 build, but not an MV3 one.**

- `apps/browser/scripts/create-firefox-build.ts` is part of `pnpm build`
  (`"build": "tsc --noEmit && node scripts/build.mjs && node scripts/create-firefox-build.ts && node scripts/create-zip-archives.ts"`).
- It copies `dist/` to `dist-firefox/` and rewrites the manifest:
  `manifest_version: 2`, `background: { scripts: [background.js], persistent: true }`
  (i.e. **background page, not a service worker**, as the mission requires),
  `action` → `browser_action`, drops `alarms`, adds `contextualIdentities`, adds
  `optional_permissions: ['cookies']` (Firefox Containers support), drops
  `host_permissions`.
- The popup is container-aware (`use-firefox-containers.ts`) and the background script
  already creates tabs with `cookieStoreId`.
- The server already accepts `moz-extension://` origins, and `apps/browser/README.md`
  links a live Firefox Add-ons listing.
- Gaps: the Firefox manifest is **derived from `manifest.json` by mutating the MV3 file**,
  which is fragile for AMO review; `web-ext` is not a dependency and there is no
  `web-ext run`/`lint` command; `getManifest()`/`browser_action`/`action` differences are
  only partly abstracted by `webextension-polyfill` (already a dependency).

Per the mission, this counts as "working Firefox build", so Phase 4 will not rewrite the
Connector in MV3: it will verify/lint the existing Firefox build, add the `web-ext` run
and lint scripts, document unlisted AMO signing, and test it against the new sidecar.
(ChatGPT, Claude and Gemini are already supported by the existing content scripts.)

---

## 8. Verdict

### GO

The port is technically feasible and no upstream behaviour has to be given up.

Evidence:

1. The protocol is small, typed in `packages/shared`, transport-agnostic from the
   browser's point of view, and authenticated in a way a Node sidecar can reproduce
   exactly (same token file, same `/health` HMAC, same `moz-extension://` origin rule).
   The Connector can stay **unmodified**.
2. The apply engine and prompt builder are already `vscode`-free and covered by 13 spec
   files, so they can be moved behind a host interface without rewriting algorithms.
3. A Firefox build that satisfies the mission's "background scripts, not service
   workers" constraint already exists.
4. The IntelliJ Platform offers first-class replacements for every coupled API:
   `WriteCommandAction` + `VirtualFile`/`Document` for writes, `DiffManager` for preview,
   `PersistentStateComponent` for settings, `stdin/stdout` process handling for the
   sidecar. Preview-before-apply is expressible, so the "show the diff first" behaviour
   is preserved.

### Recommended architecture

```
packages/core        (new, no `vscode`, no editor APIs)
  prompt/            build_prompt, edit-format + instruction constants, context formatting
  apply/             response parsers, diff/truncation/search-replace processors,
                     apply orchestration, OriginalFileState bookkeeping, revert
  host.ts            Host interface: workspaceRoots, fs read/write/delete/exists,
                     context selection, confirmDiff (preview), settings, storage
  rpc.ts             JSON-RPC 2.0 method/param types shared by sidecar and plugin
        ▲                                   ▲
        │ import                            │ JSON-RPC over stdio
apps/editor (VS Code)                 apps/sidecar (Node, bundled `out/sidecar.js`)
  host/vscode-host.ts implements Host    ├ JSON-RPC server on stdin/stdout
  (existing commands keep working)       └ WebSocket **server** on 127.0.0.1:55155
                                             (same handshake/auth/routing as today)
                                              ▲
apps/jetbrains (Kotlin/Gradle)               │ same `initialize-chat` /
  tool window + actions, owns sidecar,       │ `apply-response` messages
  DiffManager preview, WriteCommandAction    │
                                        apps/browser (Chrome MV3 + Firefox MV2, unchanged)
```

Why a sidecar rather than re-implementing in Kotlin: the diff/truncation/conflict-marker
algorithms are subtle and already tested; one Node implementation keeps VS Code, WebStorm
and tests on the same code. The sidecar owns the WebSocket so the extension keeps talking
to "the editor process" exactly as before, while the plugin only exchanges JSON-RPC with
the sidecar. The plugin, not the sidecar, performs the writes and the diff preview, which
is what makes IDE undo and VFS sync work.

Deviations to be recorded as the port proceeds:

- `packages/core` becomes the single home of the pure logic; `apps/editor` keeps thin
  re-export shims at the old paths so its existing tests and imports keep passing
  (Phase 1).
- Protocol changes: none planned. If one becomes necessary it will be additive and
  versioned (`protocol_version` in the query string) so the Chrome Connector keeps
  working.

### Risks

- **Licence** (§1) — no grant at HEAD. Blocking for distribution, not for code.
- **Apply-time heuristics** depend on model output shape; the existing parsers are the
  only thing keeping this reliable, which is why they are moved, not rewritten.
- **Sidecar lifecycle** in the IDE (Node path discovery, orphaned processes) needs
  explicit handling; the existing server already self-terminates 10 s after the last
  editor client, which the sidecar keeps.
- **Gradle/`gradlew` needs a JDK**; in the CI-style sandbox the build was run with a
  Temurin 21 installed into `$HOME/.local/opt` (see §13). `web-ext` needs npm registry
  access. Each phase reports what was actually run.

---

## 9. Phase 1 implementation — `packages/core`

`@cwc/core` now holds everything that does not need an editor:

```
packages/core/src
  types.ts                 ProposedChange, response types
  host.ts                  Host interface (see below)
  prompt/                  build-prompt, prompt-builder, edit-format-instructions,
                           instructions, diff-placeholders
  response-parser/         diff / truncated / search-replace / whole-file parsers + cases
  changes/                 diff, truncation and search-replace processors
  apply/                   strategies, apply-response (plan_changes, apply_response,
                           to_original_states), revert
  utils/                   normalize-path, get-markdown-backticks, safe-path,
                           extract-paths-from-bullet-list, cleanup-api-response
```

The `Host` boundary is deliberately small:

| Member                                                  | Used for                              |
| ------------------------------------------------------- | ------------------------------------- |
| `get_workspace_roots()`                                 | resolving paths and relative names    |
| `read_file`, `write_file`, `delete_file`, `rename_file` | the apply and revert pipeline         |
| `exists`, `list_workspace_files`                        | path validation, file pickers         |
| `get_selected_files()`                                  | context selection when none is passed |
| `confirm_changes(changes, instructions)`                | the preview-before-apply step         |
| `get_setting`, `set_setting`, `get_state`, `set_state`  | edit format, undo bookkeeping         |

Deviations from the plan, both intentional:

- The VS Code app is still `apps/editor` (not `apps/vscode`): renaming it would break
  `vsce` packaging paths and the existing scripts for no functional gain.
- Instead of rewriting the apply command, `apps/editor/src/host/vscode-host.ts`
  implements `Host` with the existing `workspace.applyEdit` / `vscode.diff` behaviour, so
  the VS Code extension is unchanged. The old module paths remain as one-line re-export
  shims (`export * from '@cwc/core/...'`), which is why all pre-existing tests still pass
  unmodified.

## 10. Phase 2 implementation — `apps/sidecar`

- **Transport**: newline-delimited JSON-RPC 2.0 on stdin/stdout (`src/json-rpc.ts`).
  stdout is protocol-only; all logging goes to stderr, because a stray `console.log`
  would corrupt the stream.
- **Methods**: `ping`, `browsers.list`, `workspace.files`, `prompt.build`,
  `chat.initialize`, `response.apply`, `response.revert`, `state.status`; notifications
  `sidecar.ready`, `browsers.changed`, `chat.applyResponse`, `host.info`, `host.error`.
- **Host**: with no `--workspace` the sidecar issues `host.*` requests back to the editor
  (`RpcHost`); with `--workspace` it uses the filesystem and auto-accepts changes
  (`FsHost`), which is what the standalone tests exercise.
- **Protocol compatibility**: the sidecar is the WebSocket _server_ and reuses the
  upstream handshake, health HMAC, origin rules (`chrome-extension://ljookipcanaglfaocjbgdicfbdhhjffp`,
  any `moz-extension://`, `DEV_CHROME_EXTENSION_ID`) and the `initialize-chat` /
  `apply-response` / `client-id-assignment` / `ping` messages. **No protocol change was
  needed.** An editor-role client with the shared `~/.cwc/.websocket-token` is accepted
  too, so the VS Code extension may coexist.
- **Port conflicts**: `EADDRINUSE` produces an explanatory error rather than silently
  taking over a server that belongs to another editor.
- **Tests** (`json-rpc.spec.ts`, `protocol.spec.ts`, `methods.spec.ts`) run with no editor:
  a real WebSocket server is driven by fake browser clients, including the Chrome and
  Firefox origins, a rejected foreign origin (`403`) and an unauthenticated editor
  (`401`).

## 11. Phase 3 implementation — `apps/jetbrains`

Kotlin 2.3.10 + IntelliJ Platform Gradle Plugin 2.20.0 on the Gradle 9.9.0 wrapper, built
directly against **WebStorm 2026.2.3 (build `WS-262.10968.77`)** via `webstorm("2026.2.3")`,
with `sinceBuild 262` and **no `untilBuild`**, so the artifact stays installable in every
later 262+ build. Java 21 toolchain (the platform's own runtime is JBR 25, but plugin
bytecode targets 21) and `allWarningsAsErrors`, so a platform deprecation fails `build`
instead of scrolling past.

| Component        | Responsibility                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `SidecarService` | spawns `node <plugin>/sidecar/sidecar.js --port …`, timeouts, stderr passthrough, dispose |
| `JsonRpcClient`  | id-matched requests, notification dispatch, `host.*` handlers                             |
| `IdeHostHandler` | `host.*`: VFS reads, `WriteCommandAction` writes, `DiffManager` preview, pickers          |
| `CwcPanel`       | tool window: context picker, instructions, chatbot + edit format, Initialize              |
| `Runner`         | shared initialize/apply/revert flow with progress and notifications                       |
| `CwcSettings`    | `PersistentStateComponent`: Node path, sidecar override, port, last chatbot/format        |
| Actions          | _Apply Chat Response from Clipboard_ (`Alt+Shift+A`), _Undo Last Changes_ (`Alt+Shift+Z`) |

Behaviour preserved from VS Code: the Connector's Apply button still only copies, and
`chat.applyResponse` causes the plugin to apply **that clipboard content**, with a
per-file `DiffManager` preview (Apply / Skip / Cancel all) before any write. Writes go
through `WriteCommandAction` + `Document`, so IDE undo, VFS refresh and save hooks work.

`apps/sidecar` gained one method, `workspace.files`, so the tool window can list the
workspace without a second implementation of the file walker.

## 12. Phase 4 implementation — Firefox

Phase 0 found a working MV2 build, so the Connector was **not** rewritten:

- `scripts/create-firefox-build.ts` now also adds the required attribution to the Firefox
  description (`… Unofficial fork of CodeWebChat by Robert Piosik.`), and a stable
  `browser_specific_settings.gecko.id` (`cwc-connector-fork@chrxmium.github`,
  `strict_min_version: 115.0`) so `web-ext sign` and update replacement work. The Chrome
  manifest is untouched.
- `apps/browser/package.json`: `web-ext` devDependency plus `firefox:lint`, `firefox:run`
  (temporary load) and `firefox:sign` (`--channel unlisted`) scripts.
- `apps/browser/README.md`: Firefox section covering the MV2/background-script build, the
  run/lint/sign commands and where to obtain AMO API keys.
- The background script opens the WebSocket (not a content script) and uses the same
  protocol and port as Chrome, so the new sidecar and the VS Code extension both serve it.

## 13. Verification log

| Check                                        | Result                                                                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx jest` (root, core + sidecar + editor)   | **pass** — 18 suites, 206 tests                                                                                                                                                                                                  |
| `tsc -p apps/sidecar/tsconfig.json --noEmit` | **pass**                                                                                                                                                                                                                         |
| `cd apps/editor && npx tsc --noEmit`         | **pass**                                                                                                                                                                                                                         |
| `node apps/sidecar/scripts/build.mjs`        | **pass** — `out/sidecar.js` bundled                                                                                                                                                                                              |
| `cd apps/browser && npm run build`           | **pass** — `dist/`, `dist-firefox/` and the zip archives                                                                                                                                                                         |
| `npx web-ext lint --source-dir dist-firefox` | **pass** — 0 errors, 0 notices, 4 warnings (`MISSING_DATA_COLLECTION_PERMISSIONS`, 3× `UNSAFE_VAR_ASSIGNMENT` for `innerHTML`)                                                                                                   |
| `./gradlew build` (apps/jetbrains)           | **pass** — Temurin 21.0.13 + Gradle 9.9.0 + plugin 2.20.0 against WebStorm 2026.2.3 (`262.10968.77`), `BUILD SUCCESSFUL` (`compileKotlin` with `allWarningsAsErrors`, `instrumentCode`, `jar`, `check`); zero Kotlin warnings    |
| `./gradlew buildPlugin`                      | **pass** — `build/distributions/code-web-chat-0.1.0.zip` (349 KB) contains `code-web-chat/lib/code-web-chat-jetbrains-0.1.0.jar`, `gson-2.11.0.jar`, `error_prone_annotations-2.27.0.jar` and `code-web-chat/sidecar/sidecar.js` |
| `./gradlew verifyPluginConfiguration`        | **pass** — part of `check`; descriptor patched with attribution, `<idea-version since-build="262"/>` and no `until-build`                                                                                                        |
| `./gradlew runIde`                           | **not run** — WebStorm's `runIde` needs an activated licence, an X display (none here: `DISPLAY` unset, `sudo` blocked by `no_new_privs`) and `libfreetype.so.6`, which the bundled JBR cannot load                              |
| Firefox run against the sidecar              | **not run** — no Firefox, no GUI, and the Connector needs a signed-in chat session                                                                                                                                               |

The Kotlin sources now compile against the real platform and the plugin ZIP is produced,
so the remaining verification gap is a live IDE session (`runIde`) and a real browser
session, not the code.

What the first compile actually surfaced, and how it was fixed:

1. `CopyPasteManager.getContents(DataFlavor.stringFlavor)` is generic in the 2025.2
   platform (`<T> getContents(flavor): T?`), so `Runner.applyFromClipboard` now passes
   the type argument explicitly (`getContents<String>(…)`); the follow-on `addProperty`
   overload error disappeared with it.
2. `buildSearchableOptions` starts a full IDE to index the settings page and aborts
   headless (`JBR … exit value 255`, `libfreetype.so.6` missing). It is now disabled in
   `build.gradle.kts`; only the Settings-search entry for the plugin is affected.
3. `buildPlugin` packaged only `lib/`, so the distribution was not self-contained: the
   ZIP task now depends on `bundleSidecar` and packs `build/sidecar` as
   `code-web-chat/sidecar/`, which `SidecarService` finds at `<plugin>/sidecar/sidecar.js`.

### Retarget to WebStorm 2026.2.3 (262)

No Kotlin source change was needed: the sources compiled clean against 262 on the first
try. Every breakage was in the build itself.

| Problem                                                                                                                      | Fix                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| IntelliJ Platform Gradle Plugin 2.6.0 cannot build 262 (262 uses the new module-descriptors.jar layout, handled from 2.20.0) | bumped to `2.20.0`                                                                                                             |
| Plugin 2.20.0 requires Gradle ≥ 9.0; the wrapper was 8.14                                                                    | wrapper `8.14` → `9.9.0`                                                                                                       |
| Kotlin 2.1.20 is older than the Kotlin the 262 platform ships against                                                        | `org.jetbrains.kotlin.jvm` `2.1.20` → `2.3.10`                                                                                 |
| `gradle.properties` targeted community 2025.2 with `untilBuild=253.*` and a `cwcWebStorm` switch                             | `platformVersion=2026.2.3`, `platformSinceBuild=262`, `untilBuild` removed, `webstorm(…)` unconditional, `cwcWebStorm` deleted |
| Gradle 9.9 flagged `val x: String by project` and `val x by tasks.registering` in our script (removed in Gradle 10)          | `providers.gradleProperty(…).get()` and `tasks.register<Copy>(…)`                                                              |
| Deprecations were only visible by eye                                                                                        | `compilerOptions { allWarningsAsErrors.set(true) }` — `compileKotlin --rerun-tasks` passes with zero warnings                  |

Platform APIs used by the plugin are _not_ deprecated in 262, which the warning-free strict
compile now proves: `CopyPasteManager.getContents<String>(…)`,
`VfsUtil.createDirectoryIfMissing`, `VfsUtilCore.iterateChildrenRecursively`,
`DiffManager`/`SimpleDiffRequest`, `Messages.showDialog`, `PluginManagerCore.getPlugin(…)`
`.pluginPath`, `JBTextArea.emptyText`, `ContentFactory.getInstance()`.

Verified platform facts: `product-info.json` in the resolved artifact reports
`"name": "WebStorm"`, `"version": "2026.2.3"`, `"buildNumber": "262.10968.77"`,
`"productCode": "WS"`; it bundles JBR `25.0.4`, while our plugin classes are major version
65 (Java 21), the level plugins are expected to target.
