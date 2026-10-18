# TLC Assist for Microsoft Teams

## Status and the hosting contract

The Teams surface is implemented for local development and offline validation.
Production hosting, corporate tenant admission, Teams sideload/sign-in, and actual
MSX/MCP/Graph access require the gates below. A successful build or ZIP check does
not establish a working or production-ready Teams installation.

**Teams does not host this application's Node service or execute a bundled backend
from an uploaded ZIP.** See Microsoft's [Teams app package guidance](https://learn.microsoft.com/microsoftteams/platform/concepts/build-and-test/apps-package).
A vendor's ZIP can feel self-contained because that vendor already operates the
service. Uploading the ZIP does not provision hosting.

For TLC Assist, the platform/application owner operates **one central service**.
The central service serves the Teams UI and same-origin API behind an approved,
reachable HTTPS origin. End users then install/upload the configured Teams package
and sign in, subject to tenant policy. **Production end users do not run Node or a
per-user backend.**

| Deliverable | Contents | Recipient and purpose |
| --- | --- | --- |
| Teams installation ZIP | Exactly `manifest.json`, `color.png` (192 x 192), `outline.png` (32 x 32) at its root | End-user/tenant-admin Teams custom-app installation |
| Host runtime ZIP | Compiled Node service and browser UI, production dependencies, safe configuration examples, knowledge PDF, runtime instructions | Central platform operator; not uploadable as a Teams app |
| Development Teams ZIP | Manifest/icons pointing to an explicitly development-only origin | Developer sideload setup; not a verified installation |

No outer distribution ZIP is required. If an operator creates one containing both
archives, that **outer archive must not be uploaded into Teams**. Extract and upload
only the three-file Teams installation ZIP. Runtime binaries, credentials, real
Foundry configuration, private state and transcripts never belong in that package.

## Architecture and trust boundaries

The [Teams host](../../apps/teams/src/server.ts) is a composition/transport shell,
not a second orchestrator. It uses the shared
[application composition](../../packages/orchestrator/application-runtime.ts),
[operation registry](../../packages/orchestrator/operations.ts),
`ThinSliceOrchestrator`, and `SharedWorkflowHost`.

The hosted Web application keeps its existing Easy Auth boundary. Teams does not
inject browser-controlled `X-MS-*` headers into it or borrow a CLI/first-party token.
The dedicated Teams host validates app-audience delegated JWTs; source tokens remain
server-side. HTTPS reachability does not mean anonymous business-data access:

- Corporate tenant, audience, calling client, delegated scope, expiry and
  IAM-backed FTE app-role checks are mandatory in live mode.
- MSX REST, Dataverse MCP and Graph use separately acquired delegated tokens.
- Native record scope, MCP default-deny/query allowlists and source health remain.
- Bot activities use current Teams SDK protocol validation before actor matching.
- Graph callbacks validate the stored subscription/client-state hash before
  persisting a hint. Hints are not access grants or write approvals.
- Writes require exact private review, a current source check, durable
  single-dispatch claim and a receipt. Native field updates carry the reviewed
  ETag rather than `If-Match: *`; self-membership deletion uses its verified ETag.
- An uncertain response or failed best-effort compensation remains
  `effect-unknown`; it is not automatically retried or reported rolled back.

The original three local planning documents are under the ignored Teams design
directory. They are historical design inputs, not evidence that the tenant gates
have passed.

## Developer prerequisites

- Node >= 22.12 and npm >= 10; Node 24 is recommended. Sample launchers explicitly
  enable the Node SQLite feature for older supported Node versions.
- Existing repository dependencies, restored using the repository package manager.
- VS Code JavaScript debugger for F5; no retired TeamsFx/BotBuilder dependency.
- For actual Teams sideloading: an approved HTTPS development tunnel or trusted
  HTTPS ingress, Teams developer/custom-app policy, and the relevant tenant accounts.
- Live development additionally needs approved Entra, source, storage, identity and
  disclosure configuration. F5 does not grant those permissions.

Keep the existing three surfaces' launchers. The new configurations are additive.

## Local runtime and F5

### Browser-only sample development

1. Open the repository in VS Code.
2. Select **TLC Teams (sample, F5)** in Run and Debug.
3. Press F5. The prelaunch task builds the actual Teams client/server, then starts
   the compiled `apps/teams/dist/server.js` from
   [the source entrypoint](../../apps/teams/src/server.ts), with source maps.
4. The readiness message opens `http://127.0.0.1:3978` in the browser. Backend
   breakpoints map to the TypeScript sources.

Equivalent command:

```powershell
npm run teams:start
```

This is a **local browser preview**, not a Teams installation or proof of F5 inside
Teams. It uses the canonical sanitized SQLite data and does not call live MSX, MCP,
Graph or Foundry. Development state and sample data persist separately under
`.tlc`; test launchers use in-memory stores.

### Complete F5-to-Teams development path

1. Obtain an approved HTTPS tunnel or ingress forwarding to local port `3978`.
   Use your organization's supported development-tunnel tooling and access policy.
   The sample contains no real customer data; never expose a live developer service
   anonymously or weaken its API/bot/callback checks.
2. Create the ignored `apps/teams/.env.teams-dev` file with:

   ```dotenv
   TLC_TEAMS_PORT=3978
   TLC_TEAMS_ORIGIN=https://YOUR-ACTUAL-HTTPS-TUNNEL-HOST
   ```

   Replace the complete origin with the tunnel's exact origin, with no path.
   The listener can remain local HTTP behind that approved HTTPS tunnel.
3. Select **TLC Teams (HTTPS tunnel, sample)** and press F5. Its build task starts
   the same real runtime; the configured API origin must match the public origin.
4. Verify the tunnel reaches both the Teams UI and `/api/health`, not the older
   Web application. The health body must identify `surface: "teams"` and the
   intended data mode.
5. Build the package for that exact HTTPS origin:

   ```powershell
   npm run teams:package -- --mode sample --origin https://YOUR-ACTUAL-HTTPS-TUNNEL-HOST --verify-origin
   ```

6. In Teams, use **Apps > Manage your apps > Upload an app** (labels can vary by
   client/policy), and upload `TLC-Assist-Teams-sample.zip`.
7. Open the personal application, then test permitted channel/meeting contexts.
   The Node debugger remains attached to your local runtime. Rebuild/relaunch
   for source edits; this launcher does not claim a background HMR pipeline.
8. If the tunnel hostname changes, update the origin and package. Live mode also
   requires corresponding approved broker/redirect and bot configuration changes.

The **TLC Teams (live, approved environment)** launcher reads the ignored
`apps/teams/.env.local`. Copy the [example](../../apps/teams/.env.example) and fill
the approved settings before using it. Never put real secrets in the launch file
or commit that environment file. Actual F5 sideload/sign-in has not been verified
without the tenant and HTTPS exposure configuration.

## Package commands and readiness checks

### Explicit development artifact

```powershell
npm run teams:package:development
```

This creates `release-teams/TLC-Assist-Teams-development.zip`. Its default HTTPS
localhost address is a template for developer exposure. It is deliberately named
and reported as **development-only**, not a working installation. It needs a
trusted HTTPS local proxy or repackaging with the actual reachable origin.

Bare packaging without a configured origin fails. Reserved example, invalid and
loopback origins cannot silently become installed-host packages.

### Configured installation package

```powershell
npm run teams:package -- --mode live --origin https://YOUR-CENTRAL-TEAMS-HOST --app-id APPROVED-TEAMS-APP-GUID --bot-id APPROVED-BOT-C-GUID --verify-origin
```

The CLI validates the pinned official Teams 1.30 schema and ZIP structure. The
hosting probe uses no credentials and verifies:

- Exact HTTPS UI/API origin and no redirect to another host.
- The actual Teams runtime health marker and matching data mode.
- The Teams HTML UI.
- An unauthenticated live session is rejected with 401.

The probe explicitly reports tenant sign-in and live data as **unverified**.
It does not validate admin consent, employee eligibility, Dataverse ACLs, bot OAuth,
Teams sideloading or actual Graph artifact access.

Every manifest URL is derived from the same configured origin. `validDomains`
contains its hostname. The bot's manifest `webApplicationInfo` identifies C's SSO
resource, not the API-A token audience. The installation ZIP never includes a
client secret or runtime.

### Runtime distribution

```powershell
npm run teams:release -- --development
```

This builds the runtime, reruns cumulative tests, creates the explicitly labeled
development app package, and builds
`TLC-Assist-Teams-runtime-<platform>-<architecture>.zip` separately.
For a configured package, supply the real origin/IDs instead of `--development`.

The runtime ZIP includes production dependencies for the packaging platform.
When the central host platform differs, restore the included locked production
dependencies using `npm ci --omit=dev` on the target platform. A Windows-native
dependency tree is not advertised as a Linux deployment.

The runtime also contains `runtime.env.example` and the deliberately unusable
disclosure-policy example. These are templates, not real credentials or an approved
policy, and `npm start` does not automatically load them. Supply approved settings
through the operator's protected environment/configuration facility.

## Central hosting: operator-owned, provisioned once

**Owner:** the organization's TLC application/platform operations team, with IAM,
MSX/Power Platform, Teams/Graph, Foundry and data-governance owners.

The operator, not each end user:

1. Provides a dedicated Node host with approved TLS ingress, DNS and networking.
   Reuse the shared backend/harness; do not fork it per user or replace the
   existing deployed Web application's trust boundary.
2. Extracts the **runtime** ZIP onto the central service, uses compatible Node and
   native dependencies, and mounts an approved writable/durable state facility.
3. Supplies live settings securely, including `TLC_TEAMS_ORIGIN` as the installed
   HTTPS origin, `TLC_TEAMS_MODE=live`, `TLC_TEAMS_HOST=0.0.0.0` when required by
   the host, and the internal port.
4. Creates the approved `TlcTeams` Azure table and grants the workload identity the
   narrow approved storage role; the application does not silently create an
   infrastructure estate. Configure identity and approved Foundry project access.
5. Starts the staged service:

   ```powershell
   npm start
   ```

6. Verifies public UI/API reachability and private 401 behavior, bot service
   delivery, Graph validation callbacks and tenant sign-in before distributing
   the configured three-file installation ZIP.
7. Publishes/permits the app through the organization's approved Teams policy.
   End users install/open it and sign in; they do not install Node.

Use a controlled single-runtime pilot until workflow execution ownership/affinity
and scale-out behavior are operationally accepted. Private state and action claims
use conditional shared storage, but existing active workflow execution is in
process; a runtime ZIP does not establish transparent distributed resumption.

No cloud deployment, resource/tenant provisioning or production replacement is
performed by these package commands.

## Required live configuration and owner evidence

| Setting/group | Owner evidence required |
| --- | --- |
| Corporate tenant and `TLC.Teams.User` role | IAM-backed FTE assignment, not email suffix or member/guest heuristics |
| API A | Confidential registration, exposed `api://A/access_as_user`, allowed B/C clients, approved delegated source grants |
| SPA B | NAA broker origin `brk-multihub://<approved-host>`, exact HTTPS popup callback `/auth/callback`, API-A permission |
| Bot C | Azure-managed Bot Service, current Teams SDK, C identifier URI `api://botid-C`, OAuth connection **`tlc-api`** returning an **A-audience** user token |
| MSX REST | Actual delegated permissions/WhoAmI/record allow-deny proof; verified write field/option mappings |
| Dataverse MCP | Exact target-tenant `mcp.tools` grant and A's actual downstream client allowlisting; registry origins must match the configured resource |
| Graph | Delegated `OnlineMeetings.Read` and `OnlineMeetingTranscript.Read.All`, admin consent, transcript tenant controls and actual organizer/invitee access |
| Collaboration metadata | Minimum installed-resource RSC `ChannelMember.Read.Group` / `ChatMember.Read.Chat`; no tenant-wide message reader |
| Disclosure policy | Protected, expiring owner-approved policy based on authoritative FTE eligibility; [example](../../config/teams-disclosure.example.json) is deliberately expired |
| State | `TLC_TEAMS_STORAGE_URL`, precreated table, private partitions, approved retention/deletion/restore and restricted audit access |
| Credential-state key | Secure 32-byte Base64 key in `TLC_TEAMS_STATE_KEY`; AES-GCM protection, rotation and reauthentication procedure |
| Foundry | Approved environment configuration and workload identity/project role; not the source user's MSX identity |

Treat A, B, C, the Teams catalog package ID and a workload managed identity as
different identities. NAA simplifies frontend token acquisition; it does not
remove the hosted policy/orchestration boundary. No browser receives downstream
MSX/MCP/Graph/Foundry credentials.

## Implemented behavior and explicit remaining gates

- Personal Accounts/Discovery, agent guidance, shared workflows, milestone/task
  edits and MCEM transitions use the existing core. Existing live record creation
  remains disabled; sample SQLite creation and reviewed live draft export remain.
- Word export and unsent email draft use the same shared document builders as
  Desktop/Web. No mail is sent automatically.
- Context bindings verify each viewer independently. Reviewed channel/chat
  snapshots have a separate FTE disclosure policy and persistent-copy contract.
- Personal bot commands reuse core reads. Channel/group messages hand off
  privately; channel-scope bot SSO is not fabricated.
- Message extensions search privately and insert authenticated private references,
  not unreviewed customer summaries into a shared conversation.
- Graph transcripts are automatically acquired, including existing and delayed
  artifacts, with bounded polling and per-meeting subscription hints. Expired
  delegated authority stops background source reads until the original user
  reauthenticates.
- Speaker-attribution denial uses the documented unattributed format, preserving
  text/timestamps and never inferring speakers from `Budget: ...`.
- Callback hints do not approve any MSX changes. A private source-checked review
  is still mandatory.

**Live meeting-stage business content remains blocked** without an authoritative
current meeting-audience proof. A channel roster or meeting-chat invitation list
does not establish who can see shared pixels, including anonymous/external
attendees. Sample stage layout is available; a channel-approved artifact cannot
silently be reused as meeting-audience permission. This is an open full-suite
release gate, not a success-shaped fallback.

Actual corporate Teams sideload/sign-in, live MSX/MCP access, Graph acquisition,
approved live writes, central hosting, interactive F5 in Teams, and operational
scale-out acceptance remain unverified until their owners provide the environment.
The full-suite production gate must not be declared passed on offline/package tests.

## Runtime limits and honest recovery

- API request admission: 60 per live user/window; new agent, workflow and transcript
  extraction admissions share a four-per-minute live-user budget. A bounded
  extraction can cover multiple transcript artifacts. Sample limits are higher.
  These are shared-state admission/context limits, not a hard monetary cap.
- MCP keeps its existing tool/rate/row/byte budgets and default-deny controls.
- Graph acquisition is bounded by request/content/segment limits and ten attempts
  per discovery pass. A distinct verified owner-scoped notification may start a
  fresh bounded pass, up to twenty notification recovery passes; duplicate hints
  and HTTP request fields cannot reset that budget. Delayed artifacts are not
  permanently blocked by the initial foreground polling limit.
- Due active subscriptions are renewed by the host's minute-scale maintenance
  while the original user's delegated session and admission remain valid.
  Paused/disconnected generations do not renew automatically. Resume plus a fresh
  foreground acquisition rechecks authority before re-enabling the subscription.
- No blind external-write retry, including ambiguous subscription creation.
- Single-dispatch action claims survive restart; already-sent effects reconcile.
- Workflow metadata survives; an unavailable in-memory execution is marked
  interrupted/unavailable, not secretly resumed or rolled back.
- Live source reads clear request-context caches; reviewed PATCH uses the exact
  native version, not a newer version fetched by a later access check.
- Credential state is isolated and encrypted, with a bounded OAuth-state lifetime.
  Do not confuse it with ordinary workflow/notification/audit documents.

### Pause, disconnect, uninstall and operator retirement

The private Activity screen provides **Pause new work**, **Resume work** and
**Disconnect work**. Pause retains authorized reads/cancellation, but rejects new
agent/workflow runs, reviewed writes, publication and acquisition. Disconnect also
blocks private-data operations until an explicit authenticated resume. It does not
sign the user out of Teams.

Admission state is durable and generation-fenced. Pause/disconnect invalidates old
approvals, unsent notifications, acquisition hints and delegated resource contexts.
The host cancels its admitted queued/running workflows and records their terminal
metadata; already dispatched source effects or model requests cannot be undone.
Receipts distinguish known `failed-before-send` from `effect-unknown`.

Signed SDK installation-removal events retire the exact personal owner, disable
delivery and clean up its bot connection without inventing FTE claims. Team/chat
removal disables that destination, not every member's private work. Late events
cannot re-enable a newer removal, and reinstallation alone does not resume private
work. A known conversation-owner mapping covers removal events without an AAD id;
unverifiable metadata is rejected and logged rather than guessed.

For operator read-only operation, configure `TLC_TEAMS_ADMISSION=read-only` and
restart the central runtime. Authorized reads and workflow cancellation remain;
user resume cannot override this setting. Only `enabled` and `read-only` are
accepted. For retirement, stop admission, drain/reconcile in-flight effects, stop
the service, and apply the approved credential/state-retention policy. Remote Graph
cleanup that lacks current delegated authority is not replaced with app-only
access; stopped subscriptions expire without further renewal.

Operational telemetry contains safe codes, method/category, duration/count where
available and correlation IDs only. No prompt text, customer names/IDs, transcript
content, tokens or raw principal payloads belong in logs.

## Validation commands and evidence boundaries

```powershell
npm run teams:typecheck
npm run test:teams
npm run test:smoke:teams
npm run lint
npm run phase0:check
npm run validate:major
npm run ext:build
npm run web:build
npm run test:smoke:revamp
```

The Teams suite is cumulative and includes identity, native ETag concurrency,
actor/digest/expiry/replay, private state, source revalidation, Graph policy/format,
webhooks, source-write review, four-surface parity, ZIP/F5 configuration and browser
journeys. See [Teams tests](../../tests/unit/teams) and
[browser tests](../../tests/e2e/teams).

Live tests stay opt-in and use approved identities/records/meetings. No package
validator can prove a real source write or tenant consent. Final handoff records
only commands actually run and explicitly lists failures/unverified gates.

### Local implementation handoff evidence

| Check | Result |
| --- | --- |
| `npm run phase0:check` | Passed: 150 files, 897 tests passed, 15 skipped; structure, sample preflight, lint and strict typing passed |
| `npm run teams:typecheck` | Passed |
| `npm run test:teams` | Passed: 26 cumulative files, 159 tests, including existing meeting regressions |
| `npm run test:smoke:teams` | Passed: nine real-browser journeys, including pause/resume, exact DOCX/EML contents and isolated tracing-snapshot probes |
| `npm run validate:major` | Passed, including Desktop build and preview smoke |
| Existing-surface regression, `playwright.revamp.config.ts` | Final full run exited successfully with `--retries=1`: 106 first-pass tests and two flaky tests passing their retry (108 total) |
| `npm run ext:build` / `npm run web:build` | Passed |
| `npm run teams:release -- --development` | Passed end to end: build, cumulative tests, script-disabled production dependency restore and both ZIPs |
| Installation package | Official 1.30 schema and exact three-file/CRC checks passed; sample/live fixture metadata validated, not installed in a tenant |
| Runtime archive | Windows x64 production dependencies, required entries, CRC and private-file exclusion checks passed |
| Staged runtime production dependency audit | `npm audit --omit=dev --prefix release-teams\runtime --json` reported zero known advisories; this is a point-in-time dependency check, not a security certification |
| Extracted runtime | Started outside the repository with module fallback disabled: UI/assets, accounts, grounded sample guidance, completed shared workflow, automatic transcript/proposals without source writes, real DOCX/unsent EML, cross-origin 403, pause/retire/resume and stale-approval 409 fencing passed; process and extraction cleaned up |

The first release attempt exposed a native Node ESM `archiver` import mismatch;
the packager now uses the repository's named `ZipArchive` API and has a native
Node regression test. An initial concurrent major-gate run timed out in an
existing ZIP64 test; a serialized rerun passed without changing that test.

The release command also exposed npm re-exporting a user `.npmrc` script allowlist
as an environment flag that npm rejects in child projects. The installer removes
only that inherited flag copy, retains the unchanged user policy/configuration,
and always passes `--ignore-scripts`. An offline native-project regression proves
its lifecycle script never executes. Native-process test timeouts are explicitly
bounded for measured Windows startup under the complete suite.

Existing-surface reruns exposed unrelated timing sensitivity in recorded voice,
mocked workflow cancellation and Desktop keyboard/Discovery interactions. The six
voice cases passed in isolation. The final full run used the same revamp
configuration with one explicit retry: Desktop blade scrolling and Desktop
Discovery passed on retry; all other cases passed first time. No unrelated
renderer code, assertions or global retry configuration were changed to hide this.

The document-download diagnostic is isolated by otherwise identical real-browser
tests with tracing snapshots enabled and disabled. Without tracing snapshots, both
downloads issue only the expected POSTs. With snapshots, tracing generates auxiliary
GET probes; those remain rejected with 404 while actual DOCX/EML content checks pass.
No unauthenticated GET download or silent fallback was added to hide these probes.

These are local development/release checks, not production acceptance. The
corporate identity, hosting, source, Teams/F5, meeting-stage audience and
operational gates above remain open.
