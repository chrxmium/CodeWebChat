# @cwc/sidecar

Node process that gives the JetBrains plugin the shared Code Web Chat logic
(prompt construction, response parsing, apply and revert) and speaks the
Connector WebSocket protocol, so the **unmodified** Chrome/Firefox extension
works with WebStorm.

Unofficial fork of [robertpiosik/CodeWebChat](https://github.com/CodeWebChat/CWC)
by Robert Piosik — see `NOTICE.md` at the repo root.

## Two channels

```
JetBrains IDE ──JSON-RPC 2.0 over stdin/stdout──▶ sidecar ──WebSocket 127.0.0.1:55155──▶ Connector
```

- **stdin/stdout**: newline-delimited JSON-RPC 2.0 (`{jsonrpc,id,method,params}`).
  stdout carries protocol frames only; logs go to stderr.
- **WebSocket**: identical handshake, authentication and message schema to the VS
  Code extension (`packages/shared/src/types/websocket-message.ts`). The sidecar
  is the _server_; the extension connects to it as a browser client. An
  editor-role client (the VS Code extension) is also accepted with the shared
  `~/.cwc/.websocket-token`, so both editors can coexist on the same protocol.

The sidecar acts as the editor for its plugin: it stamps its own `client_id` on
`initialize-chat`, and forwards the browser's `apply-response` to the plugin.

## Run

```
node out/sidecar.js [--port 55155] [--workspace /path/to/project]
```

Without `--workspace`, the sidecar expects the plugin to answer the `host.*`
methods (IDE-owned file access, diff preview). With `--workspace`, it uses the
local filesystem and accepts every change without a preview — useful for
standalone testing.

If port 55155 is already taken by another Code Web Chat server (for example the
VS Code extension), startup fails with an explanatory message instead of
silently stealing the port.

## Methods called by the plugin

| Method            | Params                                                                                                            | Result                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `ping`            | —                                                                                                                 | `{ok, pid}`                             |
| `browsers.list`   | —                                                                                                                 | `{browsers: ConnectedBrowser[]}`        |
| `prompt.build`    | `{instructions, prompt_type, edit_format, paths?}`                                                                | `{text, file_count}`                    |
| `chat.initialize` | `{text, chatbot, model?, url?, system_instructions?, options?, raw_instructions?, inject_apply_response_button?}` | `{sent, browser}`                       |
| `response.apply`  | `{response, preview?, instructions?}`                                                                             | `{applied, rejected, strategy, error?}` |
| `response.revert` | —                                                                                                                 | `{reverted, failed, error?}`            |
| `state.status`    | —                                                                                                                 | `{can_revert, files}`                   |
| `workspace.files` | —                                                                                                                 | `{root, files: [{relative, absolute}]}` |

## Notifications to the plugin

| Method                     | Params                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidecar.ready`            | `{port}`                                                                                                                                        |
| `browsers.changed`         | `{browsers}`                                                                                                                                    |
| `chat.applyResponse`       | `{client_id, raw_instructions?, web_configuration_details?}` — the Apply button copied a response; read the clipboard and call `response.apply` |
| `host.info` / `host.error` | `{message}`                                                                                                                                     |

## Requests the sidecar makes to the plugin

| Method                    | Params                     | Result                              |
| ------------------------- | -------------------------- | ----------------------------------- |
| `host.getWorkspaceRoots`  | —                          | `{roots: [{name, path}]}`           |
| `host.readFile`           | `{path}`                   | `{content}`                         |
| `host.writeFile`          | `{path, content}`          | —                                   |
| `host.deleteFile`         | `{path}`                   | —                                   |
| `host.renameFile`         | `{from, to}`               | —                                   |
| `host.exists`             | `{path}`                   | `{exists}`                          |
| `host.listWorkspaceFiles` | `{root}`                   | `{files}`                           |
| `host.getSelectedFiles`   | —                          | `{files}`                           |
| `host.confirmChanges`     | `{changes, instructions?}` | `{acceptedIds}` or `{cancel: true}` |

`host.confirmChanges` is where the IDE shows its diff (`DiffManager`) before
anything is written. The sidecar never writes files itself when the plugin host
is in use, which is what keeps `WriteCommandAction`/VFS/undo semantics intact.

## Build

```
pnpm --filter @cwc/sidecar build   # bundles to out/sidecar.js (CJS, Node 20+)
```

## Tests

```
npx jest apps/sidecar     # or the root `pnpm test`
```

`src/protocol.spec.ts` starts a real WebSocket server and drives it with browser
clients using the Chrome and Firefox origins, so the protocol compatibility is
covered without an editor or a browser.
