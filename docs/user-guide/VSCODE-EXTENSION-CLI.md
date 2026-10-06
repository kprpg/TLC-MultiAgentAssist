# VS Code Extension — Command-Line Build, Install, and Run

This guide is the command-line path for the **TLC Assist** VS Code extension: build it from
source, install the resulting `.vsix`, and run it in sample or live mode — all from a
terminal at the repository root.

- Prefer to **download a prebuilt `.vsix`** from GitHub Releases instead of building? See the
  [end-user install guide](./VSCODE-EXTENSION-INSTALL.md).
- Need **packaging, CI, and GitHub Release** details? See the
  [build, package, and deploy runbook](../runbooks/vscode-extension.md).

## Prerequisites

- **Node.js 22.12+** and **npm 10+** (see the root [`package.json`](../../package.json) `engines`).
- Dependencies installed once at the repo root: `npm install`.
- The **`code`** (VS Code) and/or **`code-insiders`** (VS Code Insiders) CLI on your `PATH`.
  Install it from the Command Palette (`Ctrl+Shift+P`) → **Shell Command: Install 'code'
  command in PATH**, then verify with `code --version` or `code-insiders --version`.
- Live mode only: an authenticated Azure CLI session (`az login`) and access to MSX and the
  configured Microsoft Foundry project. Sample mode needs none of this.

Run every command below from the **repository root**.

## Quick start (build + install + reload)

```powershell
npm install
npm run ext:reinstall:insiders   # build + package + install into VS Code Insiders
```

Then refresh the editor so it loads the new bits: Command Palette → **Developer: Reload
Window**. Use `npm run ext:reinstall` instead to target stable `code` first (it falls back to
`code-insiders`). That is the whole loop: **edit → `npm run ext:reinstall:insiders` → Reload
Window.**

## Build

```powershell
npm run ext:build     # host + webview bundles → apps/vscode-extension/dist
npm run ext:package   # → apps/vscode-extension/dist/tlc-assist-vscode.vsix
```

`ext:build` produces `dist/host/extension.cjs` (the extension host) and
`dist/webview/webview.js` + `webview.css` (the UI). `ext:package` then writes the installable
`.vsix`. `vsce` prints a size warning for the ~4 MB host bundle; that is expected.

## Install the built `.vsix`

```powershell
# Install into stable VS Code or Insiders (use whichever CLI you have)
code --install-extension apps/vscode-extension/dist/tlc-assist-vscode.vsix --force
code-insiders --install-extension apps/vscode-extension/dist/tlc-assist-vscode.vsix --force

# Verify
code-insiders --list-extensions --show-versions | Select-String tlc   # → tlc.tlc-assist-vscode@<version>

# Uninstall
npm run ext:uninstall
```

After installing, run **Developer: Reload Window** (or restart the editor) to load it.
`.vsix` installs are **not** auto-updated — re-run the build/install to upgrade.

## Run

The extension has two independent sample/live settings; the command-line launch configs below
set them via environment variables at startup.

| Variable / setting | Values | Effect |
| --- | --- | --- |
| `TLC_MODE` / `tlc.mode` | `sample` (default) · `live` | Sanitized data with no network, or real MSX OData + Dataverse MCP. |
| `TLC_DATA_STORE` / `tlc.dataStore` | `fixture` · `sqlite` | Sample data store (in-memory or persistent SQLite). Sample mode only. |
| `TLC_MEETING_EXTRACTOR` / `tlc.meetingExtractor` | `rules` · `foundry` | Offline rules or a Foundry model for meeting-transcript extraction. |
| `TLC_MEETING_MODEL` / `tlc.meetingModel` | model id | Foundry model when the extractor is `foundry` (default `gpt-6.1-sol`). |

### Run from source (F5)

Press **F5** in VS Code and pick a configuration from
[.vscode/launch.json](../../.vscode/launch.json). Each launches an **Extension Development
Host** window loaded directly from your working tree (not the installed `.vsix`):

| Launch configuration | Startup environment |
| --- | --- |
| Run TLC Assist Extension | fixtures (sample) |
| Run TLC Assist Extension (SQLite test store) | `TLC_MODE=sample`, `TLC_DATA_STORE=sqlite` |
| Run TLC Assist Extension (SQLite + Foundry extraction) | adds `TLC_MEETING_EXTRACTOR=foundry`, `TLC_MEETING_MODEL=gpt-6.1-sol` |
| Run TLC Assist Extension (Live MSX/Dataverse) | `TLC_MODE=live` |

For live mode, sign in **before** launching: run `az login` (for the Foundry agents) and sign
into VS Code with your corporate Microsoft account (for the delegated MSX token). After
changing extension code, re-run the launch (or rebuild) and **Developer: Reload Window** in
the Extension Development Host so the new build loads. If the delegated token cannot be
acquired, the extension reports an error and stays on sample — check **Output → TLC Assist**.

### Run the installed extension

Open your normal editor and select the **TLC Assist** icon in the Activity Bar (or run **TLC:
Open Assist**). Switch modes at runtime from the Command Palette — **TLC: Use Live Data
(MSX/Dataverse)** or **TLC: Use Sample Data** — or set `tlc.mode` in **Settings** (search
"tlc"). The status bar shows `TLC Assist: Live` or `Sample`. (**TLC: Test Live Connection**
only tests connectivity; it does not switch.)

> **F5 vs. installed:** the Extension Development Host reflects your working tree; the installed
> `.vsix` is a snapshot that changes only when you re-run build/install. Avoid running both for
> the same editor at once. See the [runbook](../runbooks/vscode-extension.md#debugger-f5-vs-installed-extension).

## Command cheat sheet

| Task | Command (from repo root) |
| --- | --- |
| Install dependencies | `npm install` |
| Build bundles | `npm run ext:build` |
| Package `.vsix` | `npm run ext:package` |
| Build + package + install (Insiders) | `npm run ext:reinstall:insiders` |
| Build + package + install (stable, falls back to Insiders) | `npm run ext:reinstall` |
| Stage release assets (`.vsix` + MCP config) in `release-ext/` | `npm run ext:release` |
| Uninstall | `npm run ext:uninstall` |

## Troubleshooting

- **`code` / `code-insiders` not found** — install the shell command (**Shell Command: Install
  'code' command in PATH**) and reopen the terminal.
- **Changes not visible after install** — run **Developer: Reload Window**, and confirm you are
  not also running an Extension Development Host for the same editor.
- **`vsce` packaging error about missing files** — run `npm run ext:build` first so `dist/`
  exists, then package.
- **Live mode shows auth errors** — run `az login`, or switch `tlc.mode` to `sample`.
