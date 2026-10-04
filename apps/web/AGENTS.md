# AGENTS.md — Web host / API (Easy Auth)

Node `http` host that serves the **shared `renderer-revamp` UI** plus a JSON **`/api/*`** surface.
The UI lives in `apps/desktop/renderer-revamp` (see its AGENTS.md); this package is only the
host/API/auth shell. Inherits the root AGENTS.md.

## Auth modes (`TLC_WEB_MODE` = `sample` | `azure-cli` | `easy-auth`)
- Auto-detect: `WEBSITE_SITE_NAME` present ⇒ `easy-auth`, else `sample` (`resolveWebHostMode`).
- **easy-auth** (production): read identity from App Service headers
  `x-ms-token-aad-access-token`, `x-ms-client-principal`, `x-ms-client-principal-name`; missing ⇒ 401.
  **Never** read a local Azure CLI token in this mode.
- **azure-cli** (local live): `AzureCliCredential` for the MSX scope; **must bind to loopback**
  (`assertLoopbackHost`); corp id derived from token claims with the `@microsoft.com` domain check.
- **sample**: fixed sample identity + `FixtureMsxConnector`; no network.

## API & runtime rules
- All `/api/*` requests/responses go through `packages/common` zod schemas; enforce the body cap
  (`maximumBodyBytes`, 1 MiB) and treat headers/body as **untrusted**.
- Build a **per-request `WebRuntime`** from the authenticated context (token → `LiveMsxConnector` with
  env write metadata); don't share user-scoped state across requests.
- Keep the API shape in lockstep with the other transports in `renderer-revamp/data-client.ts`
  (Electron bridge / sample) so all three surfaces behave identically.
- Non-`/api/` paths serve static files from `TLC_WEB_STATIC_ROOT` (default `apps/desktop/dist/revamp`,
  produced by `npm run web:build`).

## Validation
- `npm run web:build`, `npm run web:start` (sample) / `npm run web:start:live` (azure-cli),
  and `npm run test:smoke:revamp` for the web e2e flow.
