# Run the Desktop App

## Install a release

Open the repository's [latest release page](https://github.com/kprpg/TLC-MultiAgentAssist/releases/latest) and download either the Windows x64 installer (`.exe`) or portable archive (`.zip`).

On first launch, the packaged app creates `%APPDATA%\TLC MultiAgent Assist\foundry.environment.json` from the bundled template and opens it for editing. Configure the fields described below, save the file, and restart the app. Upgrades preserve this per-user file.

The release is currently unsigned, so Windows may display a SmartScreen warning. Verify that the download came from this repository's GitHub Releases page before running it.

## Prerequisites

- Windows 10 or later
- Node.js 22.12 or later
- npm 10 or later

Check the installed versions:

```powershell
node --version
npm --version
```

## First-time setup

From the repository root:

```powershell
npm install
```

### Configure your environment

Create your private environment file from the committed example:

```powershell
Copy-Item config/foundry.environment.example.json config/foundry.environment.json
```

Edit `config/foundry.environment.json` with your own values:

- `foundry.projectEndpoint`: copy the project endpoint from the Microsoft Foundry project overview. Its format is `https://<account>.services.ai.azure.com/api/projects/<project>`.
- `foundry.agents`: set the deployed name, type, and invocation protocol for each of the four agents.
- `authentication.appRegistration.tenantId`: your Microsoft Entra tenant ID.
- `authentication.appRegistration.clientId`: the Application (client) ID of your public-client app registration.
- `authentication.appRegistration.redirectUri`: a redirect URI configured under **Mobile and desktop applications**, normally `http://localhost`.
- `authentication.scopes`: resource scopes for Foundry, MSX, and Microsoft Graph. Outlook compose handoff uses the operating system mail handler and does not require a Graph mail scope.
- `authentication.expectedUserDomain`: the domain allowed by the local identity check.

The private file is ignored by Git. The app validates it before creating credentials or connectors. Never add client secrets, access tokens, API keys, or credential-bearing connection strings; Electron uses a public-client sign-in and cannot safely hold a client secret.

To keep the file elsewhere or maintain multiple environments, set its path before launch:

```powershell
$env:TLC_FOUNDRY_ENV_FILE = 'C:\Users\you\.tlc\contoso-foundry.json'
```

If `TLC_FOUNDRY_ENV_FILE` is not set, the app loads `config/foundry.environment.json`.

### Create the app registration

In Microsoft Entra admin center:

1. Create an app registration for this desktop app in the tenant that grants the developer access to the required resources.
2. Under **Authentication**, add the **Mobile and desktop applications** redirect URI `http://localhost` and enable public-client flows when required by tenant policy.
3. Under **API permissions**, add only the delegated permissions approved for MSX and Microsoft Graph/SharePoint data access. Outlook compose handoff does not require `Mail.ReadWrite` or `Mail.Send`. Foundry access is also enforced through Azure RBAC; assign the signed-in developer an appropriate project role such as **Foundry User**.
4. Put only the tenant ID, client ID, redirect URI, and scopes in your private JSON file.

Each developer can therefore use a different Foundry project and app registration without changing source code.

## Launch the app

The example uses `"mode": "azure-cli"`, preserving the existing local development sign-in flow for MSX and Foundry. Opening a prepared message in Outlook does not start a Microsoft Graph sign-in flow.

Sign in with your own corporate identity:

```powershell
az login
```

To use the app registration directly instead, set `authentication.mode` to `interactive-browser`. Replace the example tenant ID and client ID first; placeholder IDs will not authenticate.

The app validates the token identity against `authentication.expectedUserDomain` and displays the discovered identity in the toolbar.

Build all Electron bundles and open the desktop app:

```powershell
npm run desktop:start
```

This command builds the Electron main process, preload script, and React renderer before launching the application.
By default, accounts and opportunities come from live MSX and are scoped to active opportunities where that corporate user is on the deal team. Access tokens remain in the trusted Electron main process.

The Foundry endpoint and four agent bindings are validated at startup. Foundry invocation is enabled as each agent package is implemented; the current MCEM Coach remains deterministic and local.

To launch with sanitized fixtures instead:

```powershell
$env:TLC_DATA_MODE = 'sample'
npm run desktop:start
```

## Development mode

Start Vite in watch mode and launch Electron with live renderer updates:

```powershell
npm run desktop:dev
```

Stop development mode with `Ctrl+C` in the terminal that started it.

## Build without launching

```powershell
npm run desktop:build
```

Generated files are written under:

- `apps/desktop/dist-electron`
- `apps/desktop/dist/renderer`

## Package a Windows release

Build the Windows x64 installer and portable ZIP:

```powershell
npm run desktop:package
```

Artifacts are written under `release/`. To publish them, update the version in `apps/desktop/package.json`, commit the change, and either push a matching version tag such as `v0.1.0` or run the `Publish desktop release` workflow manually. Manual runs publish `v<desktop package version>` by default, or an explicitly provided matching tag. The `.github/workflows/release.yml` workflow validates, packages, and creates the GitHub Release automatically.

## Validate the desktop experience

Run the Electron smoke test:

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/desktop/preview.spec.ts
```

The direct Node invocation avoids Windows command-shim issues that can affect `npx playwright`.

## Theme selection

Use the sun or moon button in the top-right toolbar to switch between light and dark mode. The selected theme is saved locally and restored on the next launch.

## Share an agent response

After a Foundry agent response completes, use `Send E-mail` to enter recipients and an optional subject. TLC asks the operating system to open a prepared message in the default mail client. With Outlook registered as the mail handler, Outlook uses its signed-in corporate account; the user remains responsible for reviewing, editing, and sending the message.

The compose handoff uses a `mailto:` URI, so very long responses cannot be transferred reliably. Use `Export` for responses that exceed the supported compose size.

Use `Export` to choose a destination and save the response as a formatted Word `.docx` document. Cancelling the save dialog does not write a file.

## Troubleshooting

### Electron does not open

Rebuild the generated bundles and try again:

```powershell
npm run desktop:build
npm run desktop:start
```

### Dependencies are missing or stale

```powershell
npm install
npm run desktop:start
```

### Port 5173 is already in use

Development mode uses port 5173. Stop the process using that port, or use the production-style command instead:

```powershell
npm run desktop:start
```

### Full typecheck reports errors

The desktop build can be checked independently with:

```powershell
npm run desktop:build
```

A workspace-wide typecheck uses:

```powershell
npm run typecheck
```
