# Build, Package, and Deploy the VS Code Extension

This runbook covers building the **TLC Assist** VS Code extension from source, packaging
it into a `.vsix`, and installing ("deploying") it into your local VS Code or VS Code
Insiders so the latest bits are available without running the debugger.

The extension sources live in [`apps/vscode-extension`](../../apps/vscode-extension), and
its reference overview is in the extension [README](../../apps/vscode-extension/README.md).

## Prerequisites

- Node.js 22.12 or later and npm 10 or later (see root [`package.json`](../../package.json) `engines`).
- Dependencies installed once at the repo root: `npm install`.
- The `code` (VS Code) and/or `code-insiders` (VS Code Insiders) CLI on your `PATH`.
  - In VS Code, run **Shell Command: Install 'code' command in PATH** from the Command
    Palette. Insiders installs `code-insiders` the same way.
  - Verify: `code --version` or `code-insiders --version`.
- Packaging uses `@vscode/vsce`, which is already a dev dependency of the extension —
  no global install needed.

Live mode additionally requires an authenticated Azure CLI session (`az login`) and
access to MSX and the configured Microsoft Foundry project. Sample mode needs none of
this.

## One-command deploy (recommended)

Run from the **repository root**. These convenience scripts wrap the extension
workspace scripts so you do not need to type the `--workspace` path.

```powershell
# Build + package + install into VS Code Insiders, then reload the window to pick it up
npm run ext:reinstall:insiders

# Same, but targets stable VS Code first and falls back to Insiders
npm run ext:reinstall
```

After it finishes, refresh the running editor so it loads the new bits:

- Command Palette (`Ctrl+Shift+P`) -> **Developer: Reload Window**, or restart the editor.

That is the whole loop: **edit code -> `npm run ext:reinstall:insiders` -> Reload Window.**

## Root convenience scripts

Defined in the root [`package.json`](../../package.json):

| Script | What it does |
| --- | --- |
| `npm run ext:build` | Builds the host bundle and the webview bundle into `apps/vscode-extension/dist`. |
| `npm run ext:package` | Builds, then writes `apps/vscode-extension/dist/tlc-assist-vscode.vsix`. |
| `npm run ext:release` | Seeds the Foundry env, builds, packages, and stages the release assets (`.vsix` + MCP config zip) in `release-ext/`. |
| `npm run ext:reinstall` | Build + package + install into stable `code` (falls back to `code-insiders`). |
| `npm run ext:reinstall:insiders` | Build + package + install into `code-insiders`. |
| `npm run ext:uninstall` | Removes the installed extension (`tlc.tlc-assist-vscode`). |

Each delegates to the matching script in the extension workspace
(`apps/vscode-extension` -> `build`, `package`, `install:local`,
`install:local:insiders`, `uninstall:local`).

## Manual steps (if you want the stages separately)

### 1. Build

```powershell
npm run ext:build
```

Outputs:

- `apps/vscode-extension/dist/host/extension.cjs` — the extension host bundle.
- `apps/vscode-extension/dist/webview/webview.js` and `webview.css` — the webview UI.

### 2. Package

```powershell
npm run ext:package
```

Produces `apps/vscode-extension/dist/tlc-assist-vscode.vsix`. Files included in the
package are controlled by [`apps/vscode-extension/.vscodeignore`](../../apps/vscode-extension/.vscodeignore).
`vsce` prints a size warning for the ~4 MB host bundle; that is expected and harmless.

### 3. Install the `.vsix`

From the CLI:

```powershell
code-insiders --install-extension apps/vscode-extension/dist/tlc-assist-vscode.vsix --force
# or stable VS Code:
code --install-extension apps/vscode-extension/dist/tlc-assist-vscode.vsix --force
```

Or from the editor UI: **Extensions** view -> **...** menu -> **Install from VSIX...**,
then choose the generated file.

### 4. Verify and reload

```powershell
code-insiders --list-extensions --show-versions | Select-String tlc
```

You should see `tlc.tlc-assist-vscode@<version>`. Run **Developer: Reload Window** to
load the new bits.

## Release build (CI) and GitHub Releases

The [`Build and publish VS Code extension release`](../../.github/workflows/vscode-extension-release.yml)
workflow builds the extension, packages the `.vsix`, and publishes both the extension and a
companion MCP configuration bundle to GitHub Releases so end users can download and install
them. It is independent of the desktop and web release workflows and does not change the
"latest" desktop release.

### Trigger

- **Tag push:** push a tag that matches `ext-v*`, for example `ext-v0.1.0`. The tag must
  equal `ext-v<version>` where `<version>` is the `version` in
  [`apps/vscode-extension/package.json`](../../apps/vscode-extension/package.json); the
  workflow fails if they differ.

  ```powershell
  git tag ext-v0.1.0
  git push origin ext-v0.1.0
  ```

- **Manual run:** start the workflow from the **Actions** tab (`workflow_dispatch`).
  Without an input it publishes a run-specific tag such as `ext-v0.1.0-build.7`; supply a
  `tag` input to override.

### What it produces

Two assets are attached to the release:

| Asset | Contents |
| --- | --- |
| `tlc-assist-vscode-<version>.vsix` | The installable extension. Self-contained; bundles all dependencies and the embedded MCP registry and tool policy. |
| `tlc-assist-vscode-mcp-config-<version>.zip` | Optional MCP configuration: a ready-to-use `.vscode/mcp.json` and portable `.mcp.json` for the Dataverse MCP endpoint, the reference `config/*.json` files, and an `INSTALL.md`. |

The same files can be produced locally with `npm run ext:release`, which writes them to
`release-ext/` (git-ignored). That command seeds the shared Foundry environment, builds the
host and webview bundles, packages the `.vsix`, and stages the MCP configuration bundle.
[`scripts/package-vscode-extension-release.mjs`](../../scripts/package-vscode-extension-release.mjs)
implements the staging and zips the configuration bundle; the ready-to-use client MCP files
are generated from the enabled servers in
[`config/mcp.servers.json`](../../config/mcp.servers.json).

### Foundry environment seeding

The extension host bundle imports the git-ignored `config/foundry.environment.json` at
build and type-check time. On a clean checkout (CI) this file is absent, so both the
workflow and `npm run ext:release` seed it from the checked-in, non-secret
[`config/foundry.environment.default.json`](../../config/foundry.environment.default.json)
without overwriting a developer-provided file. This mirrors how packaged desktop releases
seed the shared Foundry configuration.

### Installing from the release

End-user install steps and prerequisites are in the
[VS Code extension install guide](../user-guide/VSCODE-EXTENSION-INSTALL.md). In short: the
only requirement to install is VS Code (or Insiders) 1.90.0+ and the `.vsix`; sample mode
needs nothing more, and live mode additionally needs a corporate Microsoft identity and (for
Foundry agents) the Azure CLI. VSIX installs are not auto-updated, so re-install the newer
`.vsix` to upgrade.

## Debugger (F5) vs. installed extension

These two paths are independent, and this is the usual source of "my change did not show
up" confusion:

- **F5 / "Run TLC Assist Extension"** ([`.vscode/launch.json`](../../.vscode/launch.json))
  launches an **Extension Development Host** window that loads the extension directly from
  source via `--extensionDevelopmentPath`. It reflects your working tree, not the
  installed `.vsix`.
- **The installed `.vsix`** is a snapshot in your normal editor. It only changes when you
  re-run a packaging/install step; code edits alone do not update it.

Guidance:

- To iterate quickly with breakpoints, keep using **F5**.
- To use the extension in your everyday editor without the debugger, use
  `npm run ext:reinstall:insiders`.
- Avoid running both at once for the same editor: if the Extension Development Host and an
  installed copy are both active, VS Code may warn about a duplicate extension. Close the
  dev-host window when testing the installed build.

## Settings that affect behavior

- `tlc.mode` (`sample` | `live`) — `sample` uses sanitized fixtures and makes no network
  calls; `live` requires delegated Microsoft identity and `az login`.
- `tlc.openOnStartup` — open the workbench automatically on activation.
- `workbench.colorCustomizations` with `editorHoverWidget.*` — set in **user settings** to
  recolor native toolbar tooltips (the Extension Development Host does not load this repo's
  workspace settings). See the design notes in
  [`docs/user-guide/USER-GUIDE.md`](../user-guide/USER-GUIDE.md).

## Troubleshooting

- **`code` / `code-insiders` not found** — install the shell command from the Command
  Palette (**Shell Command: Install 'code' command in PATH**) and reopen the terminal.
- **Changes not visible after install** — run **Developer: Reload Window**; confirm you
  are not also running an Extension Development Host for the same editor.
- **`vsce` packaging error about missing files** — run `npm run ext:build` first so
  `dist/` exists, then package.
- **Live mode shows auth errors** — run `az login`, or switch `tlc.mode` to `sample`.
