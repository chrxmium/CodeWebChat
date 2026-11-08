# Code Web Chat for JetBrains IDEs (WebStorm)

Kotlin plugin that ports [Code Web Chat](https://github.com/CodeWebChat/CWC) to
JetBrains IDEs: build a prompt from the files you pick, send it to a web chatbot
through the Connector browser extension, then apply the response to the project.

> **Unofficial fork** of [robertpiosik/CodeWebChat](https://github.com/CodeWebChat/CWC)
> by **Robert Piosik**. Not affiliated with, endorsed by or supported by the
> upstream author. The browser Connector and the VS Code extension remain the
> upstream project's work; see `NOTICE.md` at the repo root.

## Scope (MVP)

In scope:

- Initialize a chatbot (ChatGPT, Claude, Gemini, …) through the Connector, in
  Chrome and Firefox.
- Build the prompt from a context file picker, free-text instructions, the
  selected chatbot and edit format.
- Apply the response: clipboard → parse → preview in `DiffManager` → write
  through `WriteCommandAction`/VFS → revert the last apply.

Out of scope for now: API tools (code completions, commit messages), Edit
Context, Intelligent Update, and the non-essential settings.

The upstream principle is preserved: **initialize chatbots, never scrape
responses.** The Apply button in the browser extension is an alias for
copy-to-clipboard; nothing is extracted from the page.

## How it fits together

```
WebStorm ──JSON-RPC 2.0 (stdin/stdout)──▶ sidecar (Node) ──WebSocket 127.0.0.1:55155──▶ Connector
```

- The `@cwc/sidecar` process owns the WebSocket server and reuses
  `packages/core` (prompt building, apply/repair/revert), so the browser
  extension is unmodified.
- The plugin answers the sidecar's `host.*` requests: workspace roots, reading
  and writing files, listing workspace files, the current context selection and
  the diff confirmation.
- File writes go through `WriteCommandAction` and the VFS, so IDE undo, document
  sync and formatting-on-save keep working. `host.confirmChanges` shows each
  change with `DiffManager` before anything is written.

## Layout

| Path                     | Contents                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `build.gradle.kts`       | IntelliJ Platform Gradle Plugin 2.x build, sidecar bundling         |
| `src/main/resources/...` | `plugin.xml`: tool window, actions, services, settings, attribution |
| `.../sidecar`            | JSON-RPC client, process lifecycle, `host.*` handlers               |
| `.../ui`                 | Tool window (context picker, instructions, chatbot, Initialize)     |
| `.../actions`            | Apply Chat Response (clipboard), Undo Last Changes                  |
| `.../settings`           | Node path, sidecar path override, port                              |

## Build

```bash
pnpm --filter @cwc/sidecar build   # produces apps/sidecar/out/sidecar.js
cd apps/jetbrains
./gradlew build                    # compiles + builds the distributable zip
./gradlew runIde                   # sandbox IDE with the sidecar bundled
```

The sandboxed IDE is IntelliJ IDEA Community by default because it needs no
licence. The plugin only uses platform APIs; to run it on WebStorm itself, set
`cwcWebStorm=true` in `gradle.properties` (WebStorm needs an activated licence).

`build.gradle.kts` copies `apps/sidecar/out` to `build/sidecar`, then installs it
as `<plugin>/sidecar/` in the sandbox and in the packaged distribution.

If the Gradle wrapper JAR is missing (it is not committed here), generate it
once with `gradle wrapper --gradle-version 8.14` or run the system `gradle`.

## Settings

**Settings → Tools → Code Web Chat**:

- **Node path** — empty means `node` from `PATH`. Set it when WebStorm does not
  inherit your shell environment (common on macOS; for example
  `/opt/homebrew/bin/node` or the output of `nvm which default`).
- **Sidecar script** — optional override for the bundled
  `<plugin>/sidecar/sidecar.js`.
- **WebSocket port** — defaults to `55155`, the Connector's default. If the VS
  Code extension already owns the port, the sidecar reports it and refuses to
  start instead of hijacking the connection.

## Usage

1. Open the **Code Web Chat** tool window, press **Refresh**, select the context
   files, optionally type instructions, pick the chatbot and edit format.
2. Press **Initialize**: the sidecar builds the prompt and asks the Connector to
   autofill it in the chatbot tab.
3. When the answer is ready, press the response's **Apply** button (this copies
   it) and then **Apply response** in the IDE, or run
   _Code Web Chat: Apply Chat Response from Clipboard_ (`Alt+Shift+A`). The
   Connector's Apply button also triggers the apply automatically, as in VS Code.
4. **Undo last changes** (`Alt+Shift+Z`) reverts the last apply.

## Verification status

- The sidecar and `packages/core` are covered by Jest tests that run without an
  editor (`npx jest`).
- `./gradlew build` / `./gradlew runIde` could **not** be run in the environment
  this port was written in (no JDK available there), so the Kotlin sources are
  compiled and exercised only by review, not by a Gradle build. Run the two
  commands above before trusting the plugin.
