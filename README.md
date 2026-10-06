# TLC MultiAgent Assist

[![Continuous integration](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml)
[![Nightly desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml)
[![Desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml)
[![Web release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml)
[![VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml)

TLC MultiAgent Assist is an account assistant that combines live MSX opportunity context with contextual guidance on each opportunity to advance it forward. It is available in three forms, each with its own get-started steps below:

- **[VS Code shell extension](#install-the-vs-code-extension)** — brings TLC Assist into VS Code or VS Code Insiders.
- **[Windows desktop application](#install-the-desktop-app)** — a packaged Electron app with Start menu and desktop shortcuts.
- **[Web application](#web-application)** — the same experience in the browser, hosted on Azure App Service.

[Technology stack](TechStack.md)

## Install the VS Code Extension

TLC Assist is available as a VS Code extension. The only requirement to install is **VS Code (or VS Code Insiders) 1.90.0 or later** plus the released `.vsix`; it is self-contained (no Node.js, npm, or native binaries) and starts in sample mode with no sign-in or network.

1. Open the [VS Code extension releases](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=ext-v) and expand **Assets**.
2. Download `tlc-assist-vscode-<version>.vsix`. The companion `tlc-assist-vscode-mcp-config-<version>.zip` (MCP configuration and reference files) is optional — the extension already embeds its MCP registry and tool policy.
3. In VS Code, run **Extensions: Install from VSIX...** from the Command Palette (`Ctrl+Shift+P`) and choose the file, or from a terminal run `code --install-extension tlc-assist-vscode-<version>.vsix --force`. Confirm the publisher-trust prompt on VS Code 1.97+.
4. Run **Developer: Reload Window**, then select the **TLC Assist** icon in the Activity Bar or run **TLC: Open Assist**.

**Sample mode** needs nothing else. 

**Live mode** additionally requires a corporate Microsoft identity (VS Code's built-in Microsoft sign-in) and, for the Microsoft Foundry agents, the Azure CLI (`az login`). 
For using Live Data, open Control Panel on code by using Ctrl+Shift+P and then selecting "TLC Assist: TLC Use Live Data (MSX/Dataverse)" and login using corp credentials.

Extensions installed from a `.vsix` are not auto-updated — re-install a newer `.vsix` to upgrade. See the [complete VS Code extension install guide](docs/user-guide/VSCODE-EXTENSION-INSTALL.md) for details and the optional MCP setup.

### Running the extension (sample, SQLite test store, or live)

The extension has two independent toggles, set in **Settings** (search "tlc") or via environment variables / F5 launch configs:

- **Mode** (`tlc.mode`): `sample` (sanitized data, no network) or `live` (MSX OData + Dataverse MCP).
- **Sample data store** (`tlc.dataStore`): `fixture` (in-memory) or `sqlite` (the relational SQLite test store with persistent injected values). Only applies in sample mode.

You can switch at runtime without restarting: open the Command Palette (`Ctrl+Shift+P`) and run **TLC: Use Live Data (MSX/Dataverse)** or **TLC: Use Sample Data** — the status bar flips between `TLC Assist: Live` and `Sample`. (The **TLC: Test Live Connection** command only *tests* connectivity; it does not switch.)

#### Run in SQLite test-store mode (sample)

The SQLite test store is a relational database (accounts, opportunities, milestones, stakeholders, meetings/transcripts) whose injected values persist for the session — ideal for exercising writes and the meeting-capture flow offline.

- **Installed extension:** in **Settings** (search "tlc") set **`tlc.mode`** = `sample` and **`tlc.dataStore`** = `sqlite`. The change applies immediately (no reload needed). To confirm, the status bar shows `TLC Assist: Sample`.
- **From source (F5):** press **F5** and pick **Run TLC Assist Extension (SQLite test store)**. It launches an Extension Development Host with `TLC_MODE=sample` and `TLC_DATA_STORE=sqlite`.
- **Optional — Foundry model extraction:** to send meeting transcripts to a deployed Microsoft Foundry model instead of the offline rules, either set **`tlc.meetingExtractor`** = `foundry` (and optionally **`tlc.meetingModel`**, default `gpt-6.1-sol`), or press **F5** and pick **Run TLC Assist Extension (SQLite + Foundry extraction)**. This path signs in with the Azure CLI (`az login`); no API key is stored.

#### Run in live mode (MSX / Dataverse)

Live mode reads real opportunity data over MSX OData and Dataverse MCP, and (for the Foundry agents) calls Microsoft Foundry.

**Debug with F5 (from source):**

1. **Sign in first (outside VS Code debugging):** run `az login` in a terminal (needed for the Microsoft Foundry agents), and make sure you are signed into VS Code with your corporate Microsoft account (Accounts menu in the Activity Bar).
2. Open **Run and Debug** (`Ctrl+Shift+D`) and choose **Run TLC Assist Extension (Live MSX/Dataverse)** from the configuration dropdown at the top.
3. Press **F5**. This runs the `build-vscode-extension` task automatically and opens a second VS Code window (the Extension Development Host) started with `TLC_MODE=live`.
4. In the Extension Development Host, open **TLC Assist** (Activity Bar icon or **TLC: Open Assist**). When prompted, complete the VS Code Microsoft sign-in so the extension can acquire a delegated MSX token. The status bar shows `TLC Assist: Live`.
5. After changing extension code, rebuild and reload: re-run the task (or relaunch F5) and then **Developer: Reload Window** in the Extension Development Host so the new build loads.

> If the delegated token cannot be acquired, the extension shows an error and stays on sample — check **Output → TLC Assist** in the Extension Development Host.

**Meeting capture in live mode:** on an opportunity's **Overview → Milestones** header, **Meeting capture** works in live mode via **paste/upload** of a transcript. Milestone signals (commitment, risk) are written to the real milestone records for the milestones you select; other opportunity signals and recommended next steps are captured into a dated meeting note on the opportunity's comments. Writes are all-or-none (validate → apply → compensate). Set `tlc.meetingExtractor` = `foundry` to extract with a Microsoft Foundry model. (Microsoft Graph meeting acquisition is not wired yet.)

**Installed extension (no debugger):** run **TLC: Use Live Data (MSX/Dataverse)** from the Command Palette, or set **`tlc.mode`** = `live` in **Settings**. The status bar shows `TLC Assist: Live`. The `tlc.dataStore` setting is ignored in live mode.

**Developing with F5:** the repo's [.vscode/launch.json](.vscode/launch.json) provides the Extension Development Host configurations above — **Run TLC Assist Extension** (fixtures), **Run TLC Assist Extension (SQLite test store)**, **Run TLC Assist Extension (SQLite + Foundry extraction)**, and **Run TLC Assist Extension (Live MSX/Dataverse)** — which set `TLC_MODE`/`TLC_DATA_STORE` (and, for the Foundry config, `TLC_MEETING_EXTRACTOR`/`TLC_MEETING_MODEL`) as the startup default. After rebuilding the extension, run **Developer: Reload Window** in the Extension Development Host (or relaunch) so the new build loads.

## Install the Desktop App

1. Open the [latest release](https://github.com/kprpg/TLC-MultiAgentAssist/releases/latest) and expand **Assets**.
2. Download one of the Windows x64 files:
   - `TLC-MultiAgent-Assist-<version>-Windows-x64.exe` - recommended installer with Start menu and desktop shortcuts.
   - `TLC-MultiAgent-Assist-<version>-Windows-x64.zip` - portable build for users without installation access.
3. If Microsoft Edge warns that the file is not commonly downloaded, open **Downloads**, select **More actions** (**...**) beside the file, then select **Keep** and **Keep anyway**. Continue only if the file came from this repository's GitHub Releases page.
4. Open the download folder, right-click the `.exe`, select **Properties**, select **Unblock** if it is available, and then select **Apply**.
5. Double-click the installer. Choose **Only for me** for a per-user installation or **Anyone who uses this computer** for an all-users installation, then select **Next**.
6. When setup completes, leave **Run TLC MultiAgent Assist** selected and choose **Finish**.

For the portable ZIP, unblock it if prompted, select **Extract All**, and run `TLC MultiAgent Assist.exe` from the extracted folder. See the [complete desktop installation guide](docs/user-guide/DESKTOP-INSTALL.md) for detailed instructions and troubleshooting links.

## Run with Sample Data

> **Explore the desktop app without signing in or connecting to MSX, Foundry, Azure, or Microsoft Entra ID.** Close any running instance of TLC MultiAgent Assist before starting sample mode.

From **Windows Command Prompt** (`cmd.exe`) at the repository root, run:

```cmd
set "TLC_DATA_MODE=sample" && ".\release\win-unpacked\TLC MultiAgent Assist.exe"
```

After downloading the `.exe` from the GitHub Release page and installing it, replace `<UserName>` with your Windows user name and run this command from **Windows Command Prompt** (`cmd.exe`):

```cmd
set "TLC_DATA_MODE=sample" && "C:\Users\<UserName>\AppData\Local\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

For the portable ZIP, extract it, open Command Prompt in the extracted folder, and run:

```cmd
set "TLC_DATA_MODE=sample" && "TLC MultiAgent Assist.exe"
```

The quotes around `TLC_DATA_MODE=sample` are required. Without them, a space before `&&` becomes part of the value and the app starts in live mode. In sample mode, the app loads bundled sanitized data and does not display a login dialog.

PowerShell users can launch the installed app with:

```powershell
$env:TLC_DATA_MODE = 'sample'
& "$env:LOCALAPPDATA\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

## First Run

1. Start TLC MultiAgent Assist.
2. Sign in with your authorized corporate identity when prompted.

Packaged releases include the default Foundry project and agent configuration, so no endpoint setup is required for normal use.

To use your own Foundry project instead, edit `%APPDATA%\@tlc\desktop\foundry.environment.json` and replace the `foundry.projectEndpoint` and `foundry.agents` values. This per-user file overrides the bundled defaults and is preserved during upgrades. It must never contain client secrets, access tokens, API keys, or credential-bearing connection strings.

See the runbooks for complete prerequisites, build commands, startup modes, and authentication details:

- [End-user guide](docs/user-guide/USER-GUIDE.md)
- [End-user frequently asked questions](docs/FAQ.md)
- [Install the VS Code extension (end user)](docs/user-guide/VSCODE-EXTENSION-INSTALL.md)
- [Desktop setup and troubleshooting](docs/runbooks/desktop-app.md)
- [Web setup and hosting](docs/runbooks/web-app.md)
- [VS Code extension build, package, and deploy](docs/runbooks/vscode-extension.md)

## Web Application

TLC Assist also runs as a browser-based web application that serves the same revamped UI, suited for hosting on Azure App Service.

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

Build an Azure App Service-ready package with `npm run web:release`, or push a `web-v*` tag to publish the App Service ZIP to GitHub Releases. See the [web setup and hosting runbook](docs/runbooks/web-app.md) for full deployment details.

## Development

Desktop:

```powershell
npm install
Copy-Item config/foundry.environment.example.json config/foundry.environment.json
npm run desktop:start
```

Packaged desktop releases seed the non-secret shared Foundry configuration automatically and use Azure CLI sign-in (run `az login` first). The private developer file above remains ignored and can override the shared default.

Web with sample data:

```powershell
npm install
npm run web:start
```

Web with live local data uses the same private environment file plus an Azure CLI sign-in:

```powershell
az login
npm run web:start:live
```

Create local Windows release artifacts with:

```powershell
npm run desktop:package
```

Artifacts are written to `release/`. Pushing a version tag such as `v0.1.0` runs the desktop release workflow and publishes the installer and portable ZIP to GitHub Releases. Manually running the workflow publishes a visible GitHub Release with a run-specific tag such as `v0.1.0-build.2` unless a tag is supplied. Downloaded artifacts might need to be unblocked before launch. Right-click the executable, select **Properties**, and choose **Unblock**.

Pushing a tag such as `web-v0.1.0` runs the web release workflow. It validates the repository, builds and smoke-tests an isolated production package, and publishes an Azure App Service-ready ZIP to GitHub Releases. Web releases are kept separate from the latest desktop release.

Pushing a tag such as `ext-v0.1.0` runs the VS Code extension release workflow. It builds and packages the extension, then publishes the installable `.vsix` plus an optional MCP configuration bundle (`tlc-assist-vscode-mcp-config-<version>.zip`) to GitHub Releases. The tag must match the extension `version` in `apps/vscode-extension/package.json`. Produce the same artifacts locally with `npm run ext:release` (written to `release-ext/`). Extension releases are kept separate from the latest desktop release. See the [VS Code extension build, package, and release runbook](docs/runbooks/vscode-extension.md).

Deployment details are documented in the [web app runbook](docs/runbooks/web-app.md).
