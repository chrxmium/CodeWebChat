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
./gradlew buildPlugin              # only build/distributions/code-web-chat-<version>.zip
./gradlew runIde                   # sandbox IDE with the sidecar bundled
```

Requirements: JDK 21 (`JAVA_HOME` or on `PATH`) and Node. The Gradle wrapper is
committed (Gradle 9.9.0), so no system Gradle is needed. The build targets
**WebStorm 2026.2.3** (platform build `262.10968.77`) through
`webstorm("2026.2.3")`, with `sinceBuild 262` and no `untilBuild`.

```bash
export JAVA_HOME=/path/to/jdk-21   # e.g. Temurin 21
./gradlew build
```

The plugin only uses platform APIs, so compiling and packaging need no licence;
`./gradlew runIde` starts WebStorm itself and therefore needs an activated
WebStorm licence (WebStorm is free for non-commercial use). Kotlin warnings are
errors (`allWarningsAsErrors`), so a platform deprecation fails the build.

`build.gradle.kts` copies `apps/sidecar/out` to `build/sidecar`, then installs it
as `<plugin>/sidecar/` in the sandbox and in the packaged distribution, so
`build/distributions/code-web-chat-<version>.zip` is self-contained.

`buildSearchableOptions` is disabled: it boots a whole IDE to index the settings
page, which fails on a machine without a display. The only consequence is that
_Settings → Tools → Code Web Chat_ is not indexed by the IDE's Settings search.

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

Verified for this commit, with a real JDK (Temurin 21.0.13) and the committed
Gradle 9.9.0 wrapper, built against WebStorm 2026.2.3 (`262.10968.77`):

- `./gradlew build` — **pass** (_compileKotlin_ with `allWarningsAsErrors` and zero
  warnings, _instrumentCode_, _jar_, _check_).
- `./gradlew buildPlugin` — **pass**; the ZIP lands in
  `build/distributions/code-web-chat-0.1.0.zip` (349 KB) and contains
  `code-web-chat/lib/code-web-chat-jetbrains-0.1.0.jar`, `gson-2.11.0.jar`,
  `error_prone_annotations-2.27.0.jar` plus `code-web-chat/sidecar/sidecar.js`.
  The patched descriptor reads `<idea-version since-build="262"/>` with no
  `until-build`.
- `npx jest` — **pass**, 18 suites / 206 tests (core, sidecar, editor), plus
  `npx tsc --noEmit` in `apps/editor` and
  `npx tsc -p apps/sidecar/tsconfig.json --noEmit` — both **pass**.

Not verified: `./gradlew runIde` needs an activated WebStorm licence and an X display. The container this was built
in has no X server, `DISPLAY` is unset, and `sudo` is blocked by `no_new_privs`,
so `Xvfb` cannot be installed (the bundled JBR also misses
`libfreetype.so.6`). Running the plugin inside a real IDE, and the end-to-end
browser round trip, still need a desktop session:

```bash
cd apps/jetbrains && ./gradlew runIde    # on a desktop, with a browser available
```
