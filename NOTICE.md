# NOTICE

## Unofficial fork

This repository is an **unofficial fork** of [CodeWebChat/CWC](https://github.com/CodeWebChat/CWC).

- **Upstream repository:** <https://github.com/CodeWebChat/CWC>
- **Original author:** Robert Piosik
- **Upstream website:** <https://cwc.dev/> (also published as <https://codeweb.chat/>)

The fork adds a JetBrains (WebStorm) plugin and Firefox support for the Connector
browser extension. It is not affiliated with, endorsed by, or supported by Robert
Piosik or the CodeWebChat project.

## Attribution

All existing copyright notices, author credits and licence files from upstream are
kept untouched by this fork. Original work in this repository remains the property of
its respective authors — in particular:

- `apps/editor/LICENSE` — `Copyright © 2026 Robert Piosik` (unchanged)
- The browser extension manifest's `author` field — `Robert Piosik` (unchanged)
- Upstream package metadata (`publisher`, `homepage`, `repository`) (unchanged)

New components added by this fork (the JetBrains plugin, the shared core package,
the sidecar and the Firefox build of the Connector) credit the upstream project in
their own manifests and descriptions.

## Licence status of upstream

Upstream's licence history is documented in [PORTING.md](./PORTING.md). At the time of
forking, the upstream tree carries no open-source licence grant: the only licence file
is `apps/editor/LICENSE`, containing an all-rights-reserved copyright line, and no
`package.json` declares a `license` field. Git history shows a root `LICENSE` that was
Apache-2.0, then GPL-3.0, and was later removed upstream.

This notice records that state; it does not grant any rights. Anyone redistributing,
publishing or commercially using this fork is responsible for establishing that they
have the necessary permission from the copyright holder.
