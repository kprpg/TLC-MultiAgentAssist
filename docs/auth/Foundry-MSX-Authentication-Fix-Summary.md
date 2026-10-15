# Foundry/MSX Authentication Fix — Desktop, VS Code Extension, and Web

Status: Fix summary (applied and validated)
Date: 2026-10-14
Scope: What changed to resolve the Agentic Guidance authentication failure reported after a fresh
install of TLC Assist (Desktop + VS Code extension), and confirmation of behavior across all three
UI surfaces (Desktop, VS Code extension, Web).

See also: [Foundry-MSX-Authentication-Findings.md](Foundry-MSX-Authentication-Findings.md) for the
deeper investigation — SDK-level evidence of *why* the bug happened, the historical rationale for how
credentials are split across surfaces, and an open question left intentionally unverified.

## Symptom

A new user installed TLC Assist (Desktop and the VS Code extension) and hit Agentic Guidance with:

```text
Error invoking remote method 'tlc:run-agent-task': Error: Failed to get token from 'apiKey'
function: Please run 'az login' from a command prompt to authenticate before using this credential.
```

The user had already run `az login` successfully before launching TLC Assist. The error text is
misleading: the Foundry OpenAI client wraps its bearer-token callback as an `apiKey` function, so an
underlying `AzureCliCredential` failure surfaces with that wording — this was never an API key
problem.

## Root cause

Both installed surfaces were routing Foundry access through `AzureCliCredential`:

- **Desktop** shipped its packaged default with `authentication.mode: "azure-cli"`. This credential
  requests a token scoped to the configured Foundry tenant, but relies entirely on the local Azure CLI
  session having a usable token for *that specific tenant* — a successful `az login` against the
  user's default tenant does not guarantee that.
- **VS Code extension** used VS Code's built-in Microsoft sign-in for MSX, but separately used
  `AzureCliCredential` for Foundry — an inconsistent, CLI-dependent path even though the extension
  already had a working delegated-identity mechanism for MSX.

See [Foundry-MSX-Authentication-Findings.md § 2](Foundry-MSX-Authentication-Findings.md#2-azurecliCredential-cannot-use-a-custom-client-id-sdk-evidence)
for the SDK-level detail on why this credential type is fragile for this purpose.

## Summary of changes by surface

| Surface | Result | Authentication behavior |
| --- | --- | --- |
| **Desktop** | ✅ Fixed | Packaged installs now use interactive browser authentication instead of Azure CLI. |
| **VS Code extension** | ✅ Fixed | MSX and Foundry now both use VS Code's built-in Microsoft authentication provider. |
| **Web** | ✅ Already correct for production | Easy Auth authenticates the user; managed identity authenticates Foundry. Local developer web mode intentionally retains Azure CLI. |

### Desktop

The packaged default now selects `interactive-browser` and contains the approved public-client
registration in
[`config/foundry.environment.default.json`](../../config/foundry.environment.default.json).

The existing credential factory already supported separate interactive tokens for MSX and the Foundry
tenant in
[`runtime-credentials.ts`](../../apps/desktop/electron/main/runtime-credentials.ts); the release
configuration simply was not activating it.

For upgrades,
[`migrateLegacyBundledConfiguration`](../../apps/desktop/electron/main/packaged-configuration.ts)
now:

- Detects an untouched, previously-seeded `azure-cli`-only configuration.
- Replaces its authentication section with the new `interactive-browser` configuration.
- Preserves customized files and explicit `TLC_FOUNDRY_ENV_FILE` overrides.

Therefore:

- **New installs** use browser sign-in immediately.
- **Existing installs with the untouched default** migrate automatically on next launch.
- **Custom configurations** remain unchanged.

### VS Code extension

[`createVsCodeTokenCredential`](../../apps/vscode-extension/src/authentication.ts) now obtains
Foundry tokens through:

```text
vscode.authentication.getSession(
  "microsoft",
  ["VSCODE_TENANT:<foundry-tenant>", "https://ai.azure.com/.default"],
  { createIfNone: true }
)
```

This:

- Targets the configured Foundry tenant.
- Uses the Microsoft account already managed by VS Code.
- Keeps tokens inside the extension host.
- Removes the extension's runtime dependency on `az login`.

The credential is created at the extension composition root in
[`extension.ts`](../../apps/vscode-extension/src/extension.ts) and injected into both the real
Foundry Agentic Guidance agents and optional Foundry meeting extraction, via
[`live-provider.ts`](../../apps/vscode-extension/src/live-provider.ts) and
[`data-provider.ts`](../../apps/vscode-extension/src/data-provider.ts). The host-neutral provider
module itself stays free of a direct `vscode` import, preserving the sample/live provider test
boundary.

### Web

No authentication correction was needed for the deployed web surface:

- Azure-hosted Foundry calls already use
  [`ManagedIdentityCredential`](../../apps/web/src/runtime.ts).
- The browser user is authenticated through Easy Auth.
- `AzureCliCredential` remains only for the intentionally local `TLC_WEB_MODE=azure-cli` developer
  workflow in [`server.ts`](../../apps/web/src/server.ts).

## Files changed

- `apps/desktop/electron/main/packaged-configuration.ts` — legacy-default migration logic.
- `apps/vscode-extension/src/authentication.ts` — tenant-scoped VS Code token credential.
- `apps/vscode-extension/src/live-provider.ts`, `data-provider.ts`, `extension.ts` — wire the
  injected Foundry credential through the composition root instead of constructing
  `AzureCliCredential` inline.
- `apps/vscode-extension/package.json` — updated setting descriptions (Azure CLI → VS Code sign-in).
- `config/foundry.environment.default.json` — packaged default mode switched to
  `interactive-browser`, with the approved `appRegistration` block.
- `tests/unit/common/foundry-environment.test.ts`,
  `tests/unit/desktop/packaged-configuration.test.ts`,
  `tests/unit/vscode-extension/authentication.test.ts` (new) — coverage for the default's shape, the
  upgrade migration, and the tenant-scoped VS Code credential.
- `README.md`, `docs/runbooks/desktop-app.md`, `docs/runbooks/vscode-extension.md`,
  `docs/user-guide/USER-GUIDE.md`, `docs/user-guide/VSCODE-EXTENSION-CLI.md`,
  `docs/user-guide/VSCODE-EXTENSION-INSTALL.md` — replaced `az login` instructions with VS Code /
  browser sign-in guidance for the paths that changed.

## Validation performed

- `npm run phase0:check` (structure + preflight + lint + typecheck + full test suite):
  **112 test files passed, 659 tests passed, 5 skipped** — no failures.
- `npm run ext:build` — VS Code extension host + webview build succeeded.
- `npm run desktop:build` — Electron main/preload/renderer/revamp build succeeded.
- `git diff --check` — clean (no whitespace/conflict markers).
- Targeted lint pass on every changed file — one unused-parameter warning found and fixed
  (`authentication.ts`), re-verified clean.

## Release/rollout status

The fix is applied and validated in the repository working tree, but the existing installer and VSIX
under `release/` and `release-ext/` have **not** been repackaged or published. Users need newly
generated release artifacts before receiving the fix.

## Known residual gap (tracked, not fixed here)

The VS Code credential above pins the **tenant** (`VSCODE_TENANT:<id>`) but does not pin the
**client app** (`VSCODE_CLIENT_ID:<id>`) — it still authenticates under VS Code's own built-in
Microsoft app, not the TLC-registered app registration. This was a deliberate continuation of this
codebase's existing design (see the historical rationale in
[Foundry-MSX-Authentication-Findings.md § 3](Foundry-MSX-Authentication-Findings.md#3-why-the-registered-app-isnt-forced-everywhere-historical-rationale)),
not an oversight, but it's recorded here so it isn't rediscovered as a surprise later.
