# Foundry/MSX Authentication — Findings and Architecture Reference

Status: Investigation note (findings compiled after a live bug fix)
Date: 2026-10-14
Scope: How MSX and Microsoft Foundry credentials are actually constructed across Desktop, the VS
Code extension, and Web, which app registration (if any) each path uses, why a previous packaged
default broke for a new installed user, and what remains unverified.

## Why this document exists

A new user installed TLC Assist (Desktop + extension) and hit Agentic Guidance with:

```text
Error invoking remote method 'tlc:run-agent-task': Error: Failed to get token from 'apiKey'
function: Please run 'az login' from a command prompt to authenticate before using this credential.
```

...despite having already run `az login` successfully. The investigation that produced this document
found the error text is misleading (the OpenAI client wraps a bearer-token callback as an `apiKey`
function; this is not an API key problem). The real causes, and a broader question raised during
review — "shouldn't the registered Entra app be used for Foundry access?" — are captured here so the
next person touching authentication code doesn't have to re-derive it.

See also: [Foundry-MSX-Authentication-Fix-Summary.md](Foundry-MSX-Authentication-Fix-Summary.md) for
the fix as applied and validated across all three UI surfaces.

## TL;DR

- The packaged Desktop default shipped with `authentication.mode: "azure-cli"`. In that mode, the
  Foundry/MSX credential is `AzureCliCredential`, which **cannot use a custom app registration's
  client ID** — this is a hard SDK limitation, not a TLC configuration gap (see
  [§2](#2-azurecliCredential-cannot-use-a-custom-client-id-sdk-evidence)). It only lets you pin the
  *tenant* a token is requested for; the token is always issued under Azure CLI's own first-party
  app. If the signed-in CLI account cannot get a token for the configured Foundry tenant specifically
  (wrong tenant membership, guest-access friction, Conditional Access, etc.), the credential fails
  with exactly the misleading error above — `az login` having succeeded for the *default* tenant does
  not guarantee a token for the *Foundry resource's* tenant.
- The only mode that threads a registered app's `clientId` through to Foundry/MSX token requests is
  `interactive-browser` (`InteractiveBrowserCredential`). This code path already existed; it was just
  not the shipped default.
- **Fix applied:** the packaged default now ships `authentication.mode: "interactive-browser"` with
  the existing approved app registration, and a one-time migration upgrades any untouched, previously
  seeded `azure-cli` default in place. See [§5](#5-the-fix-that-was-applied).
- **Open/unverified:** the registered app (`d4a694ba-9ed0-4467-9c06-f7dfe41ceb8c`) is only
  *documented* in this repo as consented for the **MSX** delegated scope
  (`.../user_impersonation`). No file in the repo confirms it also holds a consented **Foundry**
  (`https://ai.azure.com`) delegated scope. The interactive-browser code path attempts to request a
  Foundry token under this app; whether that succeeds in practice depends on Entra ID consent state
  that isn't checked into source control. See [§7](#7-open-question-unverified-in-this-repo).
- A second GUID, `47eed744-9640-4d85-b8f5-d789569d580c`, was raised during review as a possible
  intended Foundry app registration. It does not appear anywhere in this repository (code, config,
  scripts, docs, tests) and has been confirmed **not** intended for use. Disregard it if it resurfaces
  without being wired into `config/foundry.environment*.json` first.

## 1. Credential matrix (as of this writing)

| Surface | Mode | MSX credential | Foundry credential | Uses registered app (`clientId`)? |
| --- | --- | --- | --- | --- |
| Desktop | `azure-cli` (dev/custom only, no longer the shipped default) | `AzureCliCredential` | `AzureCliCredential({ tenantId: foundryTenantId })` | **No** — cannot, by SDK design |
| Desktop | `interactive-browser` (now the shipped default) | `InteractiveBrowserCredential({ clientId, tenantId: appRegistration.tenantId })` | `InteractiveBrowserCredential({ clientId, tenantId: foundryTenantId })` | **Yes** |
| VS Code extension | live mode (MSX) | `vscode.authentication.getSession('microsoft', scopes)` | — | No — uses VS Code's own built-in first-party Microsoft app |
| VS Code extension | live mode (Foundry) | — | `vscode.authentication.getSession('microsoft', ['VSCODE_TENANT:<foundryTenantId>', ...scopes])` | **No** — tenant is pinned, but the client app is still VS Code's own, not the registered app (no `VSCODE_CLIENT_ID:<id>` pseudo-scope is passed) |
| Web | `azure-cli` (local dev only) | `AzureCliCredential` | `AzureCliCredential({ tenantId })` | No |
| Web | `easy-auth` (hosted/production) | Easy Auth injects the user token | `ManagedIdentityCredential` (system- or user-assigned) | N/A — managed identity, not a delegated user app |

Code references:

- Desktop credential factory: [`apps/desktop/electron/main/runtime-credentials.ts`](../../apps/desktop/electron/main/runtime-credentials.ts)
- Desktop MSX token provider (wraps whichever credential is selected): [`apps/desktop/electron/main/azure-cli-token-provider.ts`](../../apps/desktop/electron/main/azure-cli-token-provider.ts)
- VS Code delegated token + tenant-scoped Foundry credential: [`apps/vscode-extension/src/authentication.ts`](../../apps/vscode-extension/src/authentication.ts)
- VS Code composition root wiring the Foundry credential into live providers: [`apps/vscode-extension/src/extension.ts`](../../apps/vscode-extension/src/extension.ts) (search `configuredFoundryTenantId` / `createVsCodeTokenCredential`)
- VS Code host-neutral provider (accepts an injected credential, no direct `vscode` import): [`apps/vscode-extension/src/live-provider.ts`](../../apps/vscode-extension/src/live-provider.ts)
- Web hosted runtime (Easy Auth / managed identity / local azure-cli): [`apps/web/src/runtime.ts`](../../apps/web/src/runtime.ts), [`apps/web/src/authentication.ts`](../../apps/web/src/authentication.ts), [`apps/web/src/server.ts`](../../apps/web/src/server.ts)

## 2. `AzureCliCredential` cannot use a custom client ID (SDK evidence)

Checked directly against the installed package, not assumed:

- [`node_modules/@azure/identity/dist/esm/credentials/azureCliCredentialOptions.d.ts`](<../../node_modules/@azure/identity/dist/esm/credentials/azureCliCredentialOptions.d.ts>)
  defines the full option surface: `tenantId`, `processTimeoutInMs`, `subscription` (plus inherited
  multi-tenant options). **There is no `clientId` field.**
- [`node_modules/@azure/identity/dist/esm/credentials/azureCliCredential.js`](<../../node_modules/@azure/identity/dist/esm/credentials/azureCliCredential.js>)
  (class doc comment, line 80): *"it will read the user access token ... with Azure CLI command
  `az account get-access-token`."* It shells out to the Azure CLI process and returns whatever token
  the CLI's own session holds — always issued under Azure CLI's own first-party multi-tenant app
  (publicly documented client ID `04b07795-8ddb-461a-bbee-02f9e1bf7b46`), never a TLC-registered app.

Passing `tenantId: authentication.foundryTenantId` (as Desktop's `azure-cli` mode does for the Foundry
credential) only constrains *which tenant* the CLI is asked to mint a token for. It cannot make the
request happen under a different, custom-registered application. This is confirmed by an existing
unit test that predates this investigation:
[`tests/electron/runtime-credentials.test.ts`](../../tests/electron/runtime-credentials.test.ts) —
*"ignores an app registration in Azure CLI mode and never creates an interactive credential."*

By contrast, `InteractiveBrowserCredential` (used in `interactive-browser` mode) **does** accept and
use `clientId` — see its construction in
[`runtime-credentials.ts`](../../apps/desktop/electron/main/runtime-credentials.ts). This is the only
mode in the codebase where the registered app registration actually matters for Foundry/MSX token
acquisition.

## 3. Why the registered app isn't forced everywhere (historical rationale)

Two pre-existing design docs explain a deliberate earlier tradeoff, not an oversight:

- [`docs/VSCodeExtension-MCP-Feasibility.md`](../VSCodeExtension-MCP-Feasibility.md): a **new** TLC-owned
  app registration requires Microsoft corporate tenant admin consent, which was unavailable/blocked at
  the time. The same note records a concrete, tested rejection: *"Azure CLI client ID:
  `04b07795-8ddb-461a-bbee-02f9e1bf7b46` ... Outcome: HTTP 403 because the Azure CLI application was
  not an allowed MCP client."* That is direct proof that this tenant enforces **client-ID allowlisting**
  for at least one resource (Dataverse MCP), not just tenant membership.
- [`docs/VSCodeExtension-Implementation-Plan.md`](../VSCodeExtension-Implementation-Plan.md) (§9,
  "Authentication and Consent Position"): states the extension intentionally avoids the Easy Auth
  app-registration/admin-consent dependency and instead uses VS Code's own documented authentication
  provider.

Net effect: the team leaned on **pre-consented, broadly-trusted first-party Microsoft apps** (Azure
CLI's own app for Desktop's `azure-cli` mode; VS Code's own built-in Microsoft auth provider app for
the extension) for broad distribution, reserving the custom app registration
(`d4a694ba-9ed0-4467-9c06-f7dfe41ceb8c`) for paths where it had already gone through an actual
consent/allowlisting process (Web Easy Auth, and by extension Desktop's `interactive-browser` mode,
which reuses the same registration as a public client).

This is why the bug wasn't "someone forgot to wire up the app registration" — it was "the shipped
*default* selected the one mode where the app registration is structurally unreachable."

## 4. GUID reference

| GUID | What it is | Where it's used | Status |
| --- | --- | --- | --- |
| `d4a694ba-9ed0-4467-9c06-f7dfe41ceb8c` | App registration (client) ID, tenant `72f988bf-86f1-41af-91ab-2d7cd011db47` | `appRegistration.clientId` in [`config/foundry.environment.default.json`](../../config/foundry.environment.default.json); `$AppRegistrationClientId` default in [`scripts/configure-web-easyauth.ps1`](../../scripts/configure-web-easyauth.ps1) (line 93) | Confirmed in use for Desktop `interactive-browser` mode and Web Easy Auth. MSX scope consent documented; Foundry scope consent **not** documented anywhere in the repo (see §7). |
| `72f988bf-86f1-41af-91ab-2d7cd011db47` | Microsoft corporate Entra tenant ID (home tenant of the app registration above) | Same files as above, plus `.azure/deployment-plan.md` | Confirmed, well-known Microsoft tenant ID. |
| `173eb3fc-9ba1-437f-99a1-89d5e53b91d1` | `authentication.foundryTenantId` — the tenant that hosts the Foundry project/resource | [`config/foundry.environment.default.json`](../../config/foundry.environment.default.json) | Confirmed. Distinct from the app registration's home tenant above — this is a cross-tenant resource access scenario. |
| `00000007-0000-0000-c000-000000000000` | Well-known Dynamics CRM (MSX) resource application ID | [`scripts/configure-web-easyauth.ps1`](../../scripts/configure-web-easyauth.ps1) (line 97) | Confirmed, Microsoft-published constant. |
| `47eed744-9640-4d85-b8f5-d789569d580c` | Raised during review as a possible Foundry-specific app registration | **Not found anywhere in this repository** | Confirmed **not** intended for use (per explicit direction, 2026-10-14). Do not wire this in without first updating this document and `config/foundry.environment*.json` together. |

## 5. The fix that was applied

1. **Packaged default switched to `interactive-browser`** —
   [`config/foundry.environment.default.json`](../../config/foundry.environment.default.json) now sets
   `authentication.mode: "interactive-browser"` and includes the `appRegistration` block, so Desktop
   opens the system browser for Microsoft sign-in instead of depending on an external `az login`
   session being valid for the Foundry tenant specifically.
2. **In-place migration for existing installs** —
   [`apps/desktop/electron/main/packaged-configuration.ts`](../../apps/desktop/electron/main/packaged-configuration.ts)
   (`isLegacyBundledConfiguration` / `migrateLegacyBundledConfiguration`, from line 28) detects an
   untouched, previously-seeded `azure-cli` shared default and rewrites only its `authentication`
   section to the new `interactive-browser` configuration. Customized user files and an explicit
   `TLC_FOUNDRY_ENV_FILE` override are left untouched.
3. **VS Code extension Foundry calls now use VS Code's Microsoft sign-in instead of Azure CLI** —
   [`apps/vscode-extension/src/authentication.ts`](../../apps/vscode-extension/src/authentication.ts)
   (`createVsCodeTokenCredential`) requests a session scoped with the `VSCODE_TENANT:<foundryTenantId>`
   pseudo-scope so the token is minted for the configured Foundry tenant, removing the extension's
   runtime dependency on the Azure CLI being installed/authenticated at all. (It still does not use
   the registered app's `clientId` — see §7.)
4. **Web was already correct** and required no change: hosted/production Web uses
   `ManagedIdentityCredential` for Foundry ([`apps/web/src/runtime.ts`](../../apps/web/src/runtime.ts),
   line 34–38) and Easy Auth for the end user; `AzureCliCredential` is retained only for the
   intentionally local `TLC_WEB_MODE=azure-cli` developer workflow.

## 6. Quick checklist for anyone touching this area again

- If you add or change a credential for Foundry/MSX, first check whether it's `AzureCliCredential` —
  if so, remember it **cannot** carry a custom `clientId` under any options combination (confirmed
  against the SDK's `.d.ts` in §2). Don't try to "pass clientId anyway"; it will be silently ignored
  or rejected by TypeScript.
- If you need a specific app registration's identity to be used for a *packaged, broadly distributed*
  surface, you need `InteractiveBrowserCredential` (or another delegated flow that accepts `clientId`),
  not `AzureCliCredential`.
- For VS Code, using a custom client ID requires **both** `VSCODE_CLIENT_ID:<id>` and
  `VSCODE_TENANT:<id>` pseudo-scopes in the `getSession` scopes array — passing only the tenant (as
  the current fix does) still authenticates under VS Code's own built-in app.
- Before assuming a registered app "should just work" for a new resource (e.g. Foundry), verify its
  Entra ID API permissions/consent state directly — don't infer it from the fact that the app exists
  and is used for a *different* resource (MSX) elsewhere in the repo.
- If `47eed744-9640-4d85-b8f5-d789569d580c` (or any other new app ID) needs to be wired in, update
  `config/foundry.environment.default.json`, `config/foundry.environment.example.json`,
  `scripts/configure-web-easyauth.ps1` (if Web/Easy Auth is affected), and this document together.

## 7. Open question (unverified in this repo)

Does `d4a694ba-9ed0-4467-9c06-f7dfe41ceb8c` actually hold a consented Foundry/Cognitive Services
delegated permission in tenant `72f988bf-86f1-41af-91ab-2d7cd011db47`?

- [`scripts/configure-web-easyauth.ps1`](../../scripts/configure-web-easyauth.ps1) only declares and
  consents the Dynamics CRM `user_impersonation` permission (`$DataverseResourceAppId`,
  `$DataverseUserImpersonationScopeId`, `$MsxScope`, lines 97–99). It never references a Foundry or
  Cognitive Services resource/scope.
- No other file in the repo records a Foundry-scope consent for this app.
- The `interactive-browser` code path (§1) will *attempt* to request a Foundry token under this app
  regardless; whether Entra ID actually issues one depends on live tenant consent state that isn't
  checked into source control.

This was intentionally left unverified at the user's direction during this investigation (no live
Entra ID/Microsoft Graph query was run). If Agentic Guidance still fails under `interactive-browser`
mode with a *consent*-shaped error (as opposed to the original CLI error), this is the first place to
check — e.g. via `az ad app permission list --id d4a694ba-9ed0-4467-9c06-f7dfe41ceb8c` or the Entra
admin center — before assuming a new code change is required.
