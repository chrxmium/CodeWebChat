# Autofill for Code Web Chat

This browser extension communicates with the editor via a locally run WebSockets server.

Serves two purposes:

1. Autofilling the constructed prompt text
2. Placing _Apply Response_ button under responses

> [!TIP]
> Elevate your workflow with smart workspaces (called [projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), [gems](https://gemini.google/pl/overview/gems), or [spaces](https://docs.github.com/en/copilot/concepts/context/spaces)).

> [!NOTE]
> The _Apply Response_ button is an alias for the copy button typically placed at the end of a chat response. Once clicked, it copies the response and notifies the editor via a WebSocket message to read the clipboard.

> [!IMPORTANT]
> Prompt text is never submitted or response accepted automatically.

## Stores

- [Chrome Web Store](https://chromewebstore.google.com/detail/autofill-for-code-web-chat/ljookipcanaglfaocjbgdicfbdhhjffp)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/autofill-for-code-web-chat/)

## Permissions

The extension functions with minimal permissions.

- `storage` - Used to temporarily store prompts for [a content script](https://github.com/CodeWebChat/CWC/tree/dev/apps/browser/src/content-scripts/send-prompt-content-script), and to save extension settings.
- `alarms` (Chrome only) - Used to implement a keep-alive mechanism for the background service worker to ensure the WebSocket connection stays active.

The extension requests no host permissions. It connects to the local WebSocket server managed by the VS Code extension (`ws://localhost:55155`, or `55156` when a forwarded remote port had to be shifted).

Firefox only:

- `contextualIdentities` - Required for Firefox Containers support.
- `cookies` (optional) - Required for Firefox Containers support.

## Firefox

> **Unofficial fork** of [robertpiosik/CodeWebChat](https://github.com/CodeWebChat/CWC)
> by Robert Piosik. See `NOTICE.md` at the repo root. The attribution line is
> added to the Firefox manifest description by
> `scripts/create-firefox-build.ts`; the Chrome manifest is unchanged.

The Firefox build is generated from the same sources as the Chrome build
(`scripts/create-firefox-build.ts`): manifest v2, a **persistent background
script** instead of the service worker, `browser_action` instead of `action`,
and no `alarms` or `host_permissions`. The WebSocket is opened from the
background script, never from a content script, and uses the identical
protocol and port as the Chrome build, so the sidecar and the VS Code extension
serve both.

```bash
pnpm -C apps/browser build          # also writes dist-firefox/
pnpm -C apps/browser firefox:lint   # web-ext lint
pnpm -C apps/browser firefox:run    # web-ext run: temporary load in a Firefox
```

`web-ext run` starts Firefox with the extension temporarily installed. Sign in
in the chat tabs and it behaves exactly like the store build. Reload with `r`
in the `web-ext` terminal after a rebuild.

### AMO unlisted signing

Self-distributed builds must be signed by Mozilla. Create an API key pair at
<https://addons.mozilla.org/developers/addon/api/key/>, then:

```bash
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... pnpm -C apps/browser firefox:sign
```

The signed `.xpi` is written to `dist-firefox-signed/`. Never commit the key or
secret. The extension keeps a stable Add-on ID
(`browser_specific_settings.gecko.id`), which unlisted signing requires if you
want updates to replace the same add-on.

### Status

`web-ext lint` runs on the generated `dist-firefox` build. The Firefox build has
not been exercised against a live browser in this environment (no Firefox and no
GUI available); the WebSocket protocol it uses is covered by the sidecar's
protocol tests with `moz-extension://` origins.
