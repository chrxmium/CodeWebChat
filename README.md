# Code Web Chat for WebStorm

Unofficial fork of Code Web Chat that adds a WebStorm plugin and a Firefox Connector.

> Unofficial fork of [robertpiosik/CodeWebChat](https://github.com/robertpiosik/CodeWebChat) by Robert Piosik. Not affiliated with the upstream author. See [NOTICE.md](./NOTICE.md) and [PORTING.md](./PORTING.md).

## Install

### WebStorm 2026.2+

1. Build or grab `code-web-chat-0.1.0.zip` from `apps/jetbrains/build/distributions/`.
2. Settings > Plugins > gear icon > Install Plugin from Disk, pick the ZIP, restart.
3. Install Node.js. If WebStorm can't find it, set Settings > Tools > Code Web Chat > Node path.

### Firefox (temporary)

```bash
pnpm -C apps/browser build
pnpm -C apps/browser firefox:run
```

## Usage

1. Open the Code Web Chat tool window, refresh, and select context files.
2. Type instructions, pick a chatbot, press Initialize.
3. Copy the response with the chat's Apply button, then run Apply Chat Response from Clipboard (`Alt+Shift+A`). Review each diff before it is written.
4. Undo Last Changes: `Alt+Shift+Z`.

## Build

```bash
pnpm install --frozen-lockfile
pnpm --filter @cwc/sidecar build
cd apps/jetbrains && ./gradlew buildPlugin
```

Needs JDK 21, Node.js and pnpm.

## Credit

Original work by [Robert Piosik](https://github.com/robertpiosik): [CodeWebChat](https://github.com/robertpiosik/CodeWebChat).
