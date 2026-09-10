# Run the Web App

## Architecture

The hosted web app serves the revamp React renderer and a same-origin Node.js API from one process. The API reuses the existing MSX connector, orchestrator, shared contracts, MCEM guidance, and Foundry agents.

The host supports three data and authentication modes:

- `sample`: localhost serves bundled sanitized fixtures and does not call MSX or Foundry.
- `azure-cli`: localhost acquires MSX and Foundry tokens in the Node process from the current Azure CLI sign-in.
- `easy-auth`: Azure App Service Authentication supplies the delegated user identity and MSX token; managed identity authenticates Foundry.

## Prerequisites

All local modes require:

- Node.js 22.12 or later
- npm 10 or later
- An available loopback port, `8080` by default

Local `azure-cli` mode additionally requires Azure CLI, an authenticated corporate `az login` session, MSX access, a configured Foundry project, and the four deployed agents named in `config/foundry.environment.json`.

Hosted `easy-auth` mode additionally requires Azure App Service with Microsoft Entra authentication and token store enabled, an app registration permitted to request the delegated MSX scope, and a system- or user-assigned managed identity authorized on the Foundry project.

In Azure, App Service Authentication is the user authentication boundary. The server accepts live requests only when App Service supplies both:

- `X-MS-CLIENT-PRINCIPAL`
- `X-MS-TOKEN-AAD-ACCESS-TOKEN`

The access token must target MSX and include the tenant-approved delegated permission. The token store must be enabled. Do not forward either header from another reverse proxy unless that proxy is an explicitly trusted authentication boundary.

## Build

From the repository root:

```powershell
npm install
npm run web:build
```

This builds the shared renderer under `apps/desktop/dist/revamp` and the Node host under `apps/web/dist`.

To stage the deployable web release locally and run its production-host smoke test:

```powershell
npm run web:package
npm install --omit=dev --ignore-scripts --package-lock=false --prefix release-web/package
npm run test:smoke:web-release
```

The web release workflow performs these checks in isolation and publishes an Azure App Service ZIP for tags such as `web-v0.1.0`. The ZIP includes production dependencies, the built host and renderer, the MCEM guidance document, and the safe Foundry configuration example. It never includes `config/foundry.environment.json`.

## App Service Deployment

The PowerShell deployment wrapper builds and smoke-tests the release, validates the completed ZIP, verifies the Azure target, deploys it, and checks `/api/health`:

```powershell
npm run web:deploy
```

The default target is the production `tlc` app in `myDemoRg`. PowerShell confirmation is required before upload. Use `-WhatIf` to preview the deployment or package without contacting Azure:

```powershell
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -WhatIf
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -PackageOnly
```

To deploy an already-built package or target a slot:

```powershell
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -SkipBuild
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -Slot sample
```

The configured subscription belongs to tenant `72f988bf-86f1-41af-91ab-2d7cd011db47`. A different `-TenantId` is rejected before deployment. Before uploading, the script validates `config/foundry.environment.json`, rejects credential-like fields, and stores its Base64-encoded non-secret metadata in the `TLC_FOUNDRY_ENV_BASE64` App Service setting. The reusable ZIP still excludes the live file. Use `-FoundryEnvironmentPath` to select another environment file.

The wrapper sets `WEBSITE_RUN_FROM_PACKAGE=1`, so App Service mounts the immutable ZIP rather than extracting it and re-zipping the large `node_modules` tree. It also disables Azure CLI deployment-status tracking because a transient gateway or polling failure can produce exit code 1 after OneDeploy accepts the package. If that happens, the wrapper reconciles the newly accepted deployment record before running the bounded `/api/health` check. The script does not alter authentication, identities, networking, or deployment slots.

`azd up` is not used for this existing app. This repository has no `azure.yaml`, infrastructure definitions, or azd environment, and `azd up` combines provisioning with deployment. Adopting azd requires a separately reviewed infrastructure plan that safely represents the existing App Service before azd is allowed to own it.

After a build, the host can also be started directly with `npm start`. Set `TLC_WEB_MODE` first when a mode other than the environment-derived default is required.

## Local Startup

To run locally with sanitized sample data:

```powershell
npm run web:start
```

Open `http://127.0.0.1:8080`.

Only one local mode can use a port at a time. Stop the current sample or live host before switching modes, or choose another port:

```powershell
$env:PORT = 8081
npm run web:start:live
```

To run locally with live MSX and Foundry data, create `config/foundry.environment.json` as described in the desktop runbook, then sign in with the required corporate identity:

```powershell
az login
npm run web:start:live
```

Open `http://127.0.0.1:8080`. Access tokens stay in the local Node process and are never returned to the browser. The server validates that the MSX token belongs to a Microsoft corporate identity before creating a live runtime.

Local live mode is intended only for the signed-in developer on the same machine. The server rejects non-loopback bindings in this mode; do not place it behind a shared proxy.

## Authentication Flow

- `sample`: the browser calls the local same-origin API, which serves sanitized fixtures. No token is acquired.
- `azure-cli`: the Node host uses `AzureCliCredential` for MSX and Foundry. It validates the MSX token's user domain, creates the live runtime server-side, and returns only application data to the browser. The listener is restricted to loopback.
- `easy-auth`: App Service authenticates the user and injects the delegated MSX token and client principal through trusted `X-MS-*` headers. The Node host uses that token for MSX and a managed identity for Foundry. Neither credential is sent to browser JavaScript.

All browser API calls are same-origin. Mutating cross-origin requests are rejected.

Optional settings:

| Setting                             | Purpose                                  | Default                                       |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `PORT`                              | HTTP listener port                       | `8080`                                        |
| `HOST`                              | HTTP listener address                    | `127.0.0.1` locally; `0.0.0.0` in App Service |
| `TLC_WEB_MODE`                      | `sample`, `azure-cli`, or `easy-auth`    | `sample` locally; `easy-auth` in App Service  |
| `TLC_WEB_STATIC_ROOT`               | Built renderer directory                 | `apps/desktop/dist/revamp`                    |
| `TLC_FOUNDRY_ENV_BASE64`            | Base64-encoded hosted Foundry JSON       | unset                                         |
| `TLC_FOUNDRY_ENV_FILE`              | Foundry environment JSON                 | `config/foundry.environment.json`             |
| `WEBSITE_RUN_FROM_PACKAGE`          | Mount the deployment ZIP as `wwwroot`    | wrapper sets `1`                              |
| `TLC_MCEM_GUIDANCE_PATH`            | MCEM guidance PDF                        | `docs/knowledge/MCEM Overview.pdf`            |
| `TLC_MSX_RISK_DETAILS_FIELD`        | Verified Risk/Blocker logical field name | unset; corresponding update is rejected       |
| `TLC_MSX_STATUS_LOST_TO_COMPETITOR` | Verified integer option value            | unset; corresponding update is rejected       |
| `TLC_MSX_STATUS_HYGIENE_DUPLICATE`  | Verified integer option value            | unset; corresponding update is rejected       |
| `AZURE_CLIENT_ID`                   | User-assigned managed identity client ID | unset                                         |

The host validates the optional MSX field name and option values at startup and never guesses Dataverse metadata. Supply these settings in the local process environment or App Service application settings only after confirming the values for the target tenant.

## App Service Authentication

Configure Microsoft Entra authentication with these requirements:

1. Require authentication for unauthenticated requests.
2. Enable the App Service token store.
3. Configure the provider credential as a server-side secret or Key Vault reference.
4. Add the tenant-approved delegated MSX scope to the provider login scopes.
5. Configure the app registration redirect URI as `https://<app-name>.azurewebsites.net/.auth/login/aad/callback`.
6. Grant tenant admin consent when the selected MSX permission requires it.

The server consumes the MSX token directly. Do not configure a Microsoft Graph token in its place and do not expose the token through renderer configuration or API responses.

App Service selects `easy-auth` automatically when `WEBSITE_SITE_NAME` is present. The production `npm start` command remains compatible with a later App Service deployment; no renderer transport change is required.

Build and start the production host in App Service with:

```powershell
npm run web:build
npm start
```

## Foundry Identity

Assign the App Service user-assigned managed identity the minimum approved role on the existing Microsoft Foundry project. Set `AZURE_CLIENT_ID` to that identity's client ID. No Foundry API key or connection string is required.

## Validation

```powershell
npm run web:build
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --pretty false
node node_modules/vitest/vitest.mjs run tests/unit/web
```

After deployment, verify `/api/health`, sign in through App Service Authentication, and confirm that the account list contains only accounts reachable through opportunities where the signed-in user is an active deal-team member.
