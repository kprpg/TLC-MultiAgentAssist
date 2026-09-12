# TLC MultiAgent Assist

[![Continuous integration](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml)
[![Nightly desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml)
[![Desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml)
[![Web release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml)

TLC MultiAgent Assist is a Windows desktop application that acts as an account assistant that combines live MSX opportunity context with contextual guidance provided on the opportunity to advance them forward

[Technology stack](TechStack.md)

## Download

### [Download the latest release](https://github.com/kprpg/TLC-MultiAgentAssist/releases/latest)

On the release page, choose one of the Windows x64 files under **Assets**:

- `TLC-MultiAgent-Assist-<version>-Windows-x64.exe` installs the app and adds Start menu and desktop shortcuts.
- `TLC-MultiAgent-Assist-<version>-Windows-x64.zip` is the portable build for users without install access.

Windows may show a SmartScreen warning until release artifacts are code-signed. Confirm that the publisher and download source match this repository before continuing.

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

1. Start TLC MultiAgent Assist. The app creates your private configuration file and opens it in your default JSON editor.
2. Replace the placeholder Foundry project endpoint, agent names, tenant ID, client ID, authentication mode, and scopes.
3. Save the file and reopen the app.

The configuration is stored at `%APPDATA%\@tlc\desktop\foundry.environment.json`. It is not bundled into future upgrades and must never contain client secrets, access tokens, API keys, or credential-bearing connection strings.

For interactive sign-in, configure a public-client Microsoft Entra app registration and set `authentication.mode` to `interactive-browser`. The default `azure-cli` mode requires the Azure CLI and an authenticated `az login` session.

See the runbooks for complete prerequisites, build commands, startup modes, and authentication details:

- [End-user guide](docs/user-guide/USER-GUIDE.md)
- [End-user frequently asked questions](docs/FAQ.md)
- [Desktop setup and troubleshooting](docs/runbooks/desktop-app.md)
- [Web setup and hosting](docs/runbooks/web-app.md)

## Development

Desktop:

```powershell
npm install
Copy-Item config/foundry.environment.example.json config/foundry.environment.json
npm run desktop:start
```

Packaged desktop releases seed the non-secret shared Foundry configuration automatically and use interactive browser sign-in. The private developer file above remains ignored and can override the shared default.

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

Deployment details are documented in the [web app runbook](docs/runbooks/web-app.md).
