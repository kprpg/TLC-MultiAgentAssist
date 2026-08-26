# Run the Desktop App

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
- `authentication.scopes`: resource scopes for Foundry, MSX, and Microsoft Graph.
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
3. Under **API permissions**, add the delegated permissions approved for MSX and Microsoft Graph/SharePoint. Foundry access is also enforced through Azure RBAC; assign the signed-in developer an appropriate project role such as **Foundry User**.
4. Put only the tenant ID, client ID, redirect URI, and scopes in your private JSON file.

Each developer can therefore use a different Foundry project and app registration without changing source code.

## Launch the app

The example uses `"mode": "interactive-browser"`; the app opens the system browser when it first needs an MSX token.

To use the existing Azure CLI flow instead, set `authentication.mode` to `azure-cli`, then sign in with your own corporate identity:

```powershell
az login
```

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

## Validate the desktop experience

Run the Electron smoke test:

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/desktop/preview.spec.ts
```

The direct Node invocation avoids Windows command-shim issues that can affect `npx playwright`.

## Theme selection

Use the sun or moon button in the top-right toolbar to switch between light and dark mode. The selected theme is saved locally and restored on the next launch.

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
