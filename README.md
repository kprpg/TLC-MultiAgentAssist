# TLC MultiAgent Assist

TLC MultiAgent Assist is a Windows desktop account assistant that combines live MSX opportunity context with Microsoft Foundry agents.

## Download

### [Download the latest release](https://github.com/kprpg/TLC-MultiAgentAssist/releases/latest)

On the release page, choose one of the Windows x64 files under **Assets**:

- `TLC-MultiAgent-Assist-<version>-Windows-x64.exe` installs the app and adds Start menu and desktop shortcuts.
- `TLC-MultiAgent-Assist-<version>-Windows-x64.zip` is the portable build for users without install access.

Windows may show a SmartScreen warning until release artifacts are code-signed. Confirm that the publisher and download source match this repository before continuing.

## First Run

1. Start TLC MultiAgent Assist. The app creates your private configuration file and opens it in your default JSON editor.
2. Replace the placeholder Foundry project endpoint, agent names, tenant ID, client ID, authentication mode, and scopes.
3. Save the file and reopen the app.

The configuration is stored at `%APPDATA%\TLC MultiAgent Assist\foundry.environment.json`. It is not bundled into future upgrades and must never contain client secrets, access tokens, API keys, or credential-bearing connection strings.

For interactive sign-in, configure a public-client Microsoft Entra app registration and set `authentication.mode` to `interactive-browser`. The default `azure-cli` mode requires the Azure CLI and an authenticated `az login` session.

See [Desktop setup and troubleshooting](docs/runbooks/desktop-app.md) for the complete configuration field reference and prerequisites.

## Development

```powershell
npm install
Copy-Item config/foundry.environment.example.json config/foundry.environment.json
npm run desktop:start
```

Create local Windows release artifacts with:

```powershell
npm run desktop:package
```

Artifacts are written to `release/`. Pushing a version tag such as `v0.1.0` runs the release workflow and publishes the installer and portable ZIP to GitHub Releases.


