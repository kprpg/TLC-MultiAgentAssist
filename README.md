# TLC MultiAgent Assist

[![Continuous integration](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml)
[![Nightly desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml)
[![Desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml)
[![Web release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml)
[![VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml)
[![Nightly VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly-vscode-extension.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly-vscode-extension.yml)

TLC MultiAgent Assist is an account assistant that combines live MSX opportunity context with contextual guidance to help advance each opportunity. It ships as three surfaces from one codebase:

| Surface | What it is | Get started |
| --- | --- | --- |
| **VS Code extension** | TLC Assist inside VS Code or VS Code Insiders. | [Install](#vs-code-extension) |
| **Windows desktop app** | A packaged Electron app with Start menu and desktop shortcuts. | [Install](#desktop-app) |
| **Web application** | The same UI in the browser, hosted on Azure App Service. | [Run](#web-application) |

## Data modes

Every surface runs in one of two modes:

- **Sample mode** (default) — bundled sanitized data. No sign-in, no network; explore without touching MSX, Foundry, Azure, or Microsoft Entra ID.
- **Live mode** — real opportunity data over **MSX OData** and **Dataverse MCP**, plus Microsoft Foundry agents. Requires a corporate Microsoft identity and, for the Foundry agents, the Azure CLI (`az login`).

See [Documentation](#documentation) for the full user guide, FAQ, and runbooks.

## VS Code extension

Requires **VS Code or VS Code Insiders 1.90.0 or later**. The extension is self-contained (no Node.js, npm, or native binaries), embeds its own MCP registry and tool policy, and starts in sample mode.

### Install

1. Open the [VS Code extension releases](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=ext-v) and expand **Assets**. Stable builds and nightly **Pre-release** builds both appear here.
2. Download `tlc-assist-vscode-<version>.vsix`. The companion `tlc-assist-vscode-mcp-config-<version>.zip` is optional.
3. Install it from the Command Palette (`Ctrl+Shift+P`) with **Extensions: Install from VSIX...**, or run `code --install-extension tlc-assist-vscode-<version>.vsix --force`. Confirm the publisher-trust prompt on VS Code 1.97+.
4. Run **Developer: Reload Window**, then open **TLC Assist** from the Activity Bar (or run **TLC: Open Assist**).

`.vsix` installs are not auto-updated — re-install a newer `.vsix` to upgrade. Full walkthrough: [VS Code extension install guide](docs/user-guide/VSCODE-EXTENSION-INSTALL.md). To **build from source and install from the command line** instead, see the [command-line build, install, and run guide](docs/user-guide/VSCODE-EXTENSION-CLI.md).

### Modes and data store

Two independent toggles, set in **Settings** (search "tlc") or via the F5 launch configs:

- **`tlc.mode`** — `sample` or `live`.
- **`tlc.dataStore`** — `fixture` (in-memory) or `sqlite` (a persistent relational test store). Applies to sample mode only; ignored in live mode.

Switch at runtime from the Command Palette: **TLC: Use Live Data (MSX/Dataverse)** or **TLC: Use Sample Data**. The status bar flips between `TLC Assist: Live` and `Sample`. (**TLC: Test Live Connection** only tests connectivity; it does not switch.)

- **SQLite test store** — a relational database (accounts, opportunities, milestones, stakeholders, meetings/transcripts) whose injected values persist for the session, ideal for exercising writes and meeting capture offline. Set `tlc.dataStore` = `sqlite`, or press **F5** and pick **Run TLC Assist Extension (SQLite test store)**.
- **Live mode** — sign in first: run `az login` (for the Foundry agents) and sign into VS Code with your corporate Microsoft account (for the delegated MSX token). Then run **TLC: Use Live Data (MSX/Dataverse)** or set `tlc.mode` = `live`. If the delegated token cannot be acquired, the extension shows an error and stays on sample — check **Output → TLC Assist**.
- **Foundry meeting extraction** — set `tlc.meetingExtractor` = `foundry` (optional `tlc.meetingModel`, default `gpt-6.1-sol`) to extract transcript signals with a deployed Foundry model instead of the offline rules. Uses `az login`; no API key is stored.

**Meeting capture (live mode):** on an opportunity's **Overview → Milestones** header, paste or upload a transcript. Signals for the milestones you select (commitment, risk) are written to the real milestone records; other signals and recommended next steps are captured into a dated note on the opportunity's comments. Writes are all-or-none (validate → apply → compensate). Microsoft Graph meeting acquisition is not wired yet.

**Run from source (F5):** [.vscode/launch.json](.vscode/launch.json) provides Extension Development Host configurations — fixtures, SQLite test store, SQLite + Foundry extraction, and Live MSX/Dataverse. Full command-line build, install, and run steps are in the [command-line guide](docs/user-guide/VSCODE-EXTENSION-CLI.md); packaging and release details are in the [VS Code extension runbook](docs/runbooks/vscode-extension.md).

## Desktop app

### Install

1. Open the [latest release](https://github.com/kprpg/TLC-MultiAgentAssist/releases/latest) and expand **Assets**.
2. Download a Windows x64 file:
   - `TLC-MultiAgent-Assist-<version>-Windows-x64.exe` — recommended installer with Start menu and desktop shortcuts.
   - `TLC-MultiAgent-Assist-<version>-Windows-x64.zip` — portable build for users without installation access.
3. If the browser or Windows flags the download, choose to keep it, then right-click the file → **Properties** → **Unblock** → **Apply**. Continue only if the file came from this repository's GitHub Releases page.
4. Run the installer and choose **Only for me** or **Anyone who uses this computer**, then finish setup. For the portable ZIP, **Extract All** and run `TLC MultiAgent Assist.exe` from the extracted folder.

Detailed steps and troubleshooting: [desktop installation guide](docs/user-guide/DESKTOP-INSTALL.md).

### Run in sample mode

Close any running instance first. From **Command Prompt** (`cmd.exe`), launch the installed app with sample data:

```cmd
set "TLC_DATA_MODE=sample" && "%LOCALAPPDATA%\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

Or from **PowerShell**:

```powershell
$env:TLC_DATA_MODE = 'sample'
& "$env:LOCALAPPDATA\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

For other builds, replace the executable path: the portable ZIP runs `"TLC MultiAgent Assist.exe"` from its extracted folder, and a local build runs `".\release\win-unpacked\TLC MultiAgent Assist.exe"`. The quotes around `TLC_DATA_MODE=sample` are required — without them a trailing space becomes part of the value and the app starts in live mode. In sample mode the app loads bundled sanitized data and shows no login dialog.

### First run (live mode)

Start the app and sign in with your authorized corporate identity when prompted. Packaged releases include the default Foundry project and agent configuration, so no endpoint setup is required for normal use.

To use your own Foundry project, edit `%APPDATA%\@tlc\desktop\foundry.environment.json` and replace the `foundry.projectEndpoint` and `foundry.agents` values. This per-user file overrides the bundled defaults, is preserved during upgrades, and must never contain client secrets, access tokens, API keys, or credential-bearing connection strings.

## Web application

TLC Assist also runs as a browser-based app that serves the same UI, suited for hosting on Azure App Service.

Run locally with bundled sample data (no sign-in or network):

```powershell
npm install
npm run web:start
```

Run against live local data with an Azure CLI sign-in:

```powershell
az login
npm run web:start:live
```

Build an Azure App Service-ready package with `npm run web:release`, or push a `web-v*` tag to publish the ZIP to GitHub Releases. Full deployment details: [web setup and hosting runbook](docs/runbooks/web-app.md).

## Development

```powershell
npm install
```

### Run from source

| Target | Command | Notes |
| --- | --- | --- |
| Desktop (sample) | `npm run desktop:start` | First copy the Foundry config: `Copy-Item config/foundry.environment.example.json config/foundry.environment.json`. |
| Desktop (package) | `npm run desktop:package` | Windows artifacts are written to `release/`. |
| Web (sample) | `npm run web:start` | See [Web application](#web-application). |
| Web (live) | `az login` then `npm run web:start:live` | Uses the private Foundry environment file plus an Azure CLI sign-in. |
| VS Code extension | **F5** in VS Code | See the launch configs under [VS Code extension](#vs-code-extension), or the [command-line build/install/run guide](docs/user-guide/VSCODE-EXTENSION-CLI.md). |

Packaged desktop releases seed the non-secret shared Foundry configuration automatically and use Azure CLI sign-in (run `az login` first). The private developer file above stays ignored and can override the shared default. Downloaded artifacts may need to be unblocked before launch (right-click → **Properties** → **Unblock**).

### Release workflows

Pushing a version tag runs the matching workflow and publishes to GitHub Releases. Each release stream is kept separate from the others.

| Tag | Workflow | Publishes | Local equivalent |
| --- | --- | --- | --- |
| `v0.1.0` | Desktop release | Installer + portable ZIP | `npm run desktop:package` |
| `web-v0.1.0` | Web release | Azure App Service ZIP (validated and smoke-tested) | `npm run web:release` |
| `ext-v0.1.0` | VS Code extension release | `.vsix` + optional MCP config bundle | `npm run ext:release` |

The `ext-v*` tag must match the extension `version` in `apps/vscode-extension/package.json`. Manually running the desktop workflow publishes a run-specific tag such as `v0.1.0-build.2` unless a tag is supplied.

## Documentation

- [Technology stack](TechStack.md)
- [End-user guide](docs/user-guide/USER-GUIDE.md)
- [Frequently asked questions](docs/FAQ.md)
- [VS Code extension install (end user)](docs/user-guide/VSCODE-EXTENSION-INSTALL.md)
- [VS Code extension — command-line build, install, and run](docs/user-guide/VSCODE-EXTENSION-CLI.md)
- [Desktop setup and troubleshooting](docs/runbooks/desktop-app.md)
- [Web setup and hosting](docs/runbooks/web-app.md)
- [VS Code extension build, package, and deploy](docs/runbooks/vscode-extension.md)
