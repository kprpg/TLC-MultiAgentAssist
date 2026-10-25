# Run the Web App

## Architecture

The hosted web app serves the revamp React renderer and a same-origin Node.js API from one process. The API reuses the existing MSX connector, orchestrator, shared contracts, MCEM guidance, and Foundry agents.

The host supports three data and authentication modes:

- `sample`: local or deliberately anonymous hosted Web serves sanitized sample data and does not call live MSX, Graph, or Foundry services.
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

## Anonymous Sample Deployment

**No IaC is required for this existing App Service.** Reuse the ZIP packaging and
Azure CLI deployment wrapper. The configured target is subscription
`cbaf34df-7bb5-4fcf-bd7d-686a5f43ad31`, resource group `myDemoRg`, app `tlc`,
plan `ASP-myDemoRg-94e3`, with the existing **`sample`** slot.
The app is **Linux / Node 24**, not Windows. Its P0v3 plan supports slots and
currently has one worker. The slot's hostname starts with `tlc-sample`, but its
resource name is `sample`.

Visitors need no login, tokens, Azure CLI, Foundry configuration, or live-service
permissions. The **publisher** needs Node.js 24+, npm, PowerShell 7, and an authorized
Azure CLI session for Azure operations. Build/package-only needs no Azure sign-in:

```powershell
npm run web:release:sample
# Or use the deployment entry point without contacting Azure:
npm run web:deploy:sample -- -PackageOnly
```

Both build and smoke-test the actual staged host. The ZIP remains reusable;
runtime mode is configured explicitly at deployment, not embedded in the browser.
Production dependency installation disables lifecycle scripts. The isolated npm
installs remove npm-run's inherited `allow-scripts` CLI flag, which newer npm
rejects for project installs; `--ignore-scripts` remains enforced and user npm
configuration is not changed.

### Deploy and test the sample slot

```powershell
# Sign in as the publisher beforehand if needed: az login
npm run web:deploy:sample

# Reuse an already-built ZIP:
npm run web:deploy:sample -- -SkipBuild

# Read-only Azure preview (may build); no settings/upload/auth changes:
npm run web:deploy:sample -- -SkipBuild -WhatIf

# Only if the named slot is missing, explicitly permit creation:
npm run web:deploy:sample -- -CreateSlot
```

Sample mode requires a named non-production slot and never falls back to
production. Slot creation does not clone live configuration, create an App
Service/plan, or upgrade the plan. The script rejects incompatible runtime,
platform, tenant, plan, hostname, or scaling rather than changing a shared plan.
Other targets can be selected explicitly:

```powershell
pwsh -NoProfile -File .\scripts\deploy-web-appservice.ps1 -Mode sample -Slot sample `
    -SubscriptionId '<subscription-id>' -TenantId '<tenant-id>' `
    -ResourceGroup '<resource-group>' -WebAppName '<app-name>' `
    -AppServicePlan '<existing-plan-name>' -ExpectedHostName '<production-hostname>'
```

The sample workflow sets `TLC_WEB_MODE=sample`, `TLC_DATA_MODE=sample`,
`TLC_DATA_STORE=sqlite`, `TLC_DATA_STORE_PATH=:memory:`,
`TLC_HOSTING_MODEL=single-instance`, `TLC_BACKGROUND_SYNC=0`, and `HOST=0.0.0.0`.
It uses run-from-package, disables remote build automation, and retains the
platform `PORT` and Node runtime. **`TLC_DATA_MODE=sample` alone is insufficient**:
without explicit `TLC_WEB_MODE`, App Service selects live Easy Auth mode.

Authentication is disabled only on the selected sample target. Existing
network restrictions are not removed; a restricted target must be deliberately
made accessible by its owner before it can pass the public checks. HTTPS remains
required. Local-only host Exit is unavailable on hosted Web; visitors cannot
stop the shared process. Inherited live background-sync settings do not activate
a durable sample journal in Azure.

The wrapper detects each slot's **active** authentication version. Classic Auth v1
uses `az webapp auth-classic update`; Auth v2 uses `az webapp auth update`.
It does not migrate authentication or change production merely to deploy a sample
slot. A v1 sample slot and v2 production slot are supported together.
Protected production promotion requires v2's health-route exclusions; an enabled
v1 production policy is rejected before changes rather than weakened or migrated.

Verification uses no credentials/cookies and never follows login redirects.
It checks the sample HTML marker, sample identity, seeded accounts/opportunities,
and SQLite-backed meeting transcripts, not just `/api/health`. A successful
upload or public health endpoint alone is not success. Wait for the script's
verified-sample message, then evaluate the demo manually at the reported slot URL.

**Data lifecycle:** in-memory SQLite enables the fuller sample experience,
including sample meeting capture and edits, without writable database files or
another Azure resource. Anonymous visitors share a dataset/identity within one
process. Edits reset on recycle, deployment, or swap; this is not per-visitor
isolation. Do not upload real customer transcripts or credentials. Keep one
worker; the workflow does not scale or alter the shared plan automatically.

### Recover a completed upload

If upload completed but a later settings/check step failed, use the existing ZIP
to verify and finalize it without rebuilding, uploading, or changing Azure:

```powershell
npm run web:deploy:sample -- -Action Verify
```

This checks the ZIP hash against the slot's release marker, the completed active
deployment, sample configuration, disabled authentication, and anonymous SQLite
APIs before saving the missing local receipt. It refuses a mismatched ZIP or an
authenticated slot; it does not silently repair settings or overwrite an active
production rollback receipt. `-WhatIf` does not write the receipt.

The error `Cannot use auth v2 commands when the app is using auth v1` is an
authentication **API-version mismatch**, not a publisher sign-in/RBAC or SCM
publishing-credential error. Earlier wrappers could hit it even when classic
authentication was already disabled. The updated wrapper selects the correct
command without forcing migration to v2. If a manual setting change is needed,
select deployment slot **sample** in App Service and disable its Authentication;
do not disable production authentication to fix a sample-slot deployment.

### Promote or roll back explicitly

Staging deployment does not change production. The current production target
requires login; promotion deliberately converts it into a **public sample demo**:

```powershell
npm run web:deploy:sample -- -Action Promote
npm run web:deploy:sample -- -Action Rollback
```

Each operation requires confirmation. Promotion rechecks the recorded staged
deployment and swaps it without rebuilding or uploading another ZIP. Effective
sample settings are applied deliberately on both sides; existing slot-sticky
flags are preserved. `TLC_SAMPLE_RELEASE_ID` tracks the ZIP's SHA256 with content
and must **not** be marked slot-sticky.

Production keeps authentication while live content could still be served. Only
the non-sensitive `/api/health` route is temporarily excluded from authentication
for HTTP-200 swap warm-up; previous exclusions are restored. Anonymous production
access is opened only after the sample content/configuration is active, then
functional checks must pass. Native swap-with-preview/auto-swap is not assumed.
If promotion fails, prior enabled authentication is reapplied and the failure is
reported; use the retained receipt to request recovery.

The default local receipt is `release-web\tlc-sample-deployment.json` (ignored by
Git). It contains the exact target, ZIP hash, accepted deployment ID, state, and
only managed non-secret settings/authentication flags needed for rollback. It
does not contain tokens, provider secrets, or the Foundry environment. Use
`-ReceiptPath` to select another location, and retain it with the deployment.

Rollback restores required authentication **before** any previous live content
or mode, verifies both authentication flags and an actual anonymous-access denial
before a reverse swap, then restores managed values and sticky flags,
and verifies the anonymous-access policy. Authenticated live functionality still
requires its normal sign-in to verify. A changed staging/rollback deployment or
mismatched receipt is rejected. A subsequent deployment to the source slot would
destroy the rollback point, so the wrapper refuses to overwrite it while the
receipt records an active production transition. Archive the receipt explicitly
only when you intend to discard that rollback point.

### Local release validation

For an actual packaged-host browser check as well as the normal release smoke:

```powershell
$env:TLC_WEB_RELEASE_BROWSER_SMOKE = '1'
try { npm run web:release:sample }
finally { Remove-Item Env:TLC_WEB_RELEASE_BROWSER_SMOKE -ErrorAction SilentlyContinue }
```

This exercises the real staged Node host, clean-browser sample navigation, host
shutdown restrictions, and SQLite edit/reset behavior. It does not deploy to
Azure. The local dual-mode demo launcher intentionally also starts live mode and
requires Azure login; it is not used by this deployment workflow.

## Live / Easy Auth App Service Deployment

The PowerShell deployment wrapper builds and smoke-tests the release, validates the completed ZIP, verifies the Azure target, deploys it, and checks `/api/health`:

```powershell
npm run web:deploy
```

The default target is the production `tlc` app in `myDemoRg`. PowerShell confirmation is required before upload. `-WhatIf` previews mutations but may build and inspect Azure. `-PackageOnly` builds without contacting Azure:

```powershell
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -WhatIf
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -PackageOnly
```

To deploy an already-built package or target a slot:

```powershell
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -SkipBuild
pwsh -NoProfile -File scripts/deploy-web-appservice.ps1 -Slot live-staging
```

The configured subscription belongs to tenant `72f988bf-86f1-41af-91ab-2d7cd011db47`. A different `-TenantId` is rejected before deployment. Before uploading, the script validates `config/foundry.environment.json`, rejects credential-like fields, and stores its Base64-encoded non-secret metadata in the `TLC_FOUNDRY_ENV_BASE64` App Service setting. The reusable ZIP still excludes the live file. Use `-FoundryEnvironmentPath` to select another environment file.

The live wrapper sets `WEBSITE_RUN_FROM_PACKAGE=1`, so App Service mounts the immutable ZIP rather than extracting it and re-zipping the large `node_modules` tree. It also disables Azure CLI deployment-status tracking because a transient gateway or polling failure can produce exit code 1 after OneDeploy accepts the package. If that happens, the wrapper reconciles the newly accepted deployment record before running the bounded `/api/health` check. This default live path does not alter authentication, identities, networking, or deployment slots; the explicit sample workflow above manages its own sample settings, authentication and slot lifecycle.

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

- `sample`: the browser calls the same-origin API, which serves sanitized fixtures or the SQLite sample store. No token is acquired.
- `azure-cli`: the Node host uses `AzureCliCredential` for MSX and Foundry. It validates the MSX token's user domain, creates the live runtime server-side, and returns only application data to the browser. The listener is restricted to loopback.
- `easy-auth`: App Service authenticates the user and injects the delegated MSX token and client principal through trusted `X-MS-*` headers. The Node host uses that token for MSX and a managed identity for Foundry. Neither credential is sent to browser JavaScript.

All browser API calls are same-origin. Mutating cross-origin requests are rejected.

Optional settings:

| Setting                             | Purpose                                  | Default                                       |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `PORT`                              | HTTP listener port                       | `8080`                                        |
| `HOST`                              | HTTP listener address                    | Loopback in local/sample mode; `0.0.0.0` in Easy Auth; sample deployment explicitly sets `0.0.0.0` |
| `TLC_WEB_MODE`                      | `sample`, `azure-cli`, or `easy-auth`    | `sample` locally; `easy-auth` in App Service  |
| `TLC_DATA_STORE`                    | Sample data store (`fixture` or `sqlite`) | Fixture sample data unless `sqlite` is selected |
| `TLC_DATA_STORE_PATH`               | File-backed Sample SQLite database       | In-memory when unset; local demo launcher supplies a path |
| `TLC_WEB_STATIC_ROOT`               | Built renderer directory                 | `apps/desktop/dist/revamp`                    |
| `TLC_FOUNDRY_ENV_BASE64`            | Base64-encoded hosted Foundry JSON       | unset                                         |
| `TLC_FOUNDRY_ENV_FILE`              | Foundry environment JSON                 | `config/foundry.environment.json`             |
| `WEBSITE_RUN_FROM_PACKAGE`          | Mount the deployment ZIP as `wwwroot`    | wrapper sets `1`                              |
| `TLC_SAMPLE_RELEASE_ID`            | Non-sticky sample ZIP SHA256 for guarded swaps | Set by the sample deployment wrapper |
| `TLC_MCEM_GUIDANCE_PATH`            | MCEM guidance PDF                        | `docs/knowledge/MCEM Overview.pdf`            |
| `TLC_MSX_RISK_DETAILS_FIELD`        | Verified Risk/Blocker logical field name | unset; corresponding update is rejected       |
| `TLC_MSX_STATUS_LOST_TO_COMPETITOR` | Verified integer option value            | unset; corresponding update is rejected       |
| `TLC_MSX_STATUS_HYGIENE_DUPLICATE`  | Verified integer option value            | unset; corresponding update is rejected       |
| `TLC_MSX_ACCOUNT_TPID_FIELD`         | Optional tenant TPID logical-field override | verifies known `msp_mstopparentid` when unset |
| `TLC_PORTFOLIO_PREFERENCES_PATH`     | Durable account-preference JSON path     | `.tlc/portfolio-preferences.json`              |
| `AZURE_CLIENT_ID`                   | User-assigned managed identity client ID | unset                                         |
| `TLC_BACKGROUND_SYNC`               | Opt in to confirmed background admission | `0` / acknowledged writes |
| `TLC_MUTATION_TABLE_URL`            | Existing HTTPS Azure Table service endpoint, no SAS/credentials in URL | unset |
| `TLC_MUTATION_TABLE_NAME`           | Existing private receipt table | `TlcMutations` |
| `TLC_MUTATION_STATE_PATH`           | Sample-only durable receipt SQLite file | `.tlc/web-sample-mutations.sqlite` |

The host validates optional MSX field names and option values at startup. TPID lookup
verifies the override or the known default against readable String metadata before use;
unknown/incompatible fields and authorization errors remain explicit. Supply tenant
overrides in the process environment or App Service settings only after verification.
Name-based account search remains independent of TPID metadata. Close-name fallback
requires provisioned, synchronized Dataverse account-name indexing and uses the same
delegated connector as Desktop and VS Code; it never creates an MSX account.

`TLC_PORTFOLIO_PREFERENCES_PATH` must point to durable writable storage in hosted environments. Preferences are partitioned by the immutable authenticated user ID and contain manually added and hidden account IDs only. They do not replace or modify MSX Deal Team records. In a scaled-out App Service deployment, mount the same durable path for every instance or replace the JSON store with an approved shared persistence implementation before enabling multi-instance writes.

## Cached browsing and optional background writes

Browsing is memory-only in each browser session, with lazy details/catalogs and
visible stale revalidation (5 minutes for mutable data, 30 for references).
Tabs, filters and fresh cached Portfolio navigation do not query MSX again.
Refresh checks the source explicitly; errors retain marked-stale confirmed data.
The backend remains authenticated and constructed per request.

For live background writes, configure an **existing** receipt table and its approved
managed-identity data permissions before setting `TLC_BACKGROUND_SYNC=1`. The app
does not provision storage or grant access. Never use a worker-local ephemeral
SQLite journal for a multi-instance live Web deployment. Source writes still need
explicit confirmation, current authorization and exact native versions.

Read the [policy, supported live subset and recovery/rollback procedure](../performance/performance-optimization.md#adaptive-freshness-and-confirmed-background-writes).
Disable admission with `TLC_BACKGROUND_SYNC=0`, but retain the table configuration
so old private receipts can still be reconciled. Uncertain writes are never replayed.

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
