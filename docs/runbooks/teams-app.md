# TLC Assist for Microsoft Teams

## Status and the local-now, Azure-later hosting contract

The Teams surface is implemented for local development and offline validation.
Corporate tenant admission, approved HTTPS ingress, Teams sideload/sign-in, and
actual MSX/MCP/Graph access require the gates below. A successful build or ZIP check does
not establish a working or production-ready Teams installation.

**Teams does not host this application's Node service or execute a bundled backend
from an uploaded ZIP.** See Microsoft's [Teams app package guidance](https://learn.microsoft.com/microsoftteams/platform/concepts/build-and-test/apps-package).
A vendor's ZIP can feel self-contained because that vendor already operates the
service. Uploading the ZIP does not provision hosting.

**You operate the application:** run it as an ordinary web application on your
Windows laptop for development/test now, then optionally deploy the **same
runtime** to a hosting platform such as Azure. There is no vendor or other person
assumed to be running it for you, and Azure hosting is not a prerequisite for local
development. Only credential, state, secret and origin configuration changes
between environments; the backend/orchestrator does not fork.

The audience includes other Microsoft FTE colleagues. After you start/configure
the selected host and approved HTTPS exposure, they install the Teams package and
sign in independently. They never inherit your MSX/Dataverse/Graph access or need
to run a separate backend per person. Remote source and Foundry dependencies
remain; local processing does not make those services offline.

| Deliverable | Contents | Recipient and purpose |
| --- | --- | --- |
| Teams installation ZIP | Exactly `manifest.json`, `color.png` (192 x 192), `outline.png` (32 x 32) at its root | End-user/tenant-admin Teams custom-app installation |
| Host runtime ZIP | Compiled Node service and browser UI, production dependencies, safe configuration examples, knowledge PDF, runtime instructions | You run it locally now or deploy it later; not uploadable as a Teams app |
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
- Live development additionally needs approved Entra, source, identity and
  disclosure configuration. F5 does not grant those permissions.
- Local/live Foundry access uses Azure CLI and its approved tenant/project role;
  a laptop does not acquire a managed identity just by running Node. Azure Table
  Storage and an Azure-hosted app are not required for the local profile.

Keep the existing three surfaces' launchers. The new configurations are additive.

## Local runtime and F5

### One-script build, run and upload

Use [run-teams-local.ps1](../../scripts/run-teams-local.ps1) from PowerShell **7.4+**
in the repository. It performs the requested sequence:

1. Rebuilds the backend/browser runtime ZIP and runs the cumulative Teams tests.
2. Rebuilds the three-file Teams installation ZIP for the **same** origin/mode.
3. Extracts a new versioned runtime beneath your local AppData, configures stable
   external data paths, starts Node, and verifies the local and trusted HTTPS UI/API.
4. Uses `atk install` to upload/sideload that exact ZIP for your Microsoft 365
   account. Login, consent or tenant app-upload policy can still require interaction.

For same-laptop sample testing, supply **real, existing, trusted** localhost PEM
certificate/key files. Paths such as `C:\YOUR_CERT_FOLDER\localhost.pem` and
`C:\YOUR_KEY_FOLDER\localhost-key.pem` are placeholders, not files the runner
creates. The runner rejects missing files or directories before building or
starting anything.

If you do not have an approved certificate/key pair, one option is
[mkcert](https://github.com/FiloSottile/mkcert#windows). Install it using its
Windows instructions only if your organization permits it, then run this
**one-time setup** separately. `mkcert -install` changes certificate trust and
may prompt for permission; do not run it without approval. Keep private keys
outside the repository, never share them, and do not use development
certificates for production.

```powershell
$certDir = Join-Path $env:LOCALAPPDATA 'TLC-Assist\Teams\certs'
New-Item -ItemType Directory -Path $certDir -Force | Out-Null
mkcert -install
if ($LASTEXITCODE -ne 0) { throw 'Installing the development certificate trust failed.' }
mkcert -cert-file "$certDir\localhost.pem" -key-file "$certDir\localhost-key.pem" localhost 127.0.0.1 ::1
if ($LASTEXITCODE -ne 0) { throw 'Creating the localhost certificate/key failed.' }
```

With the trusted pair in that per-user directory (or replace `$certDir` with
your actual certificate directory), launch from the repository:

```powershell
$certDir = Join-Path $env:LOCALAPPDATA 'TLC-Assist\Teams\certs'
.\scripts\run-teams-local.ps1 `
  -Origin https://localhost:3979 `
  -CertificatePath "$certDir\localhost.pem" `
  -PrivateKeyPath "$certDir\localhost-key.pem"
```

The runtime now supports direct TLS through `TLC_TEAMS_TLS_CERT_PATH` and
`TLC_TEAMS_TLS_KEY_PATH`; both must be present and the configured origin must be
HTTPS. The runner can read those paths from `-ConfigPath` instead of command
parameters. It never generates/trusts a certificate or bypasses certificate
validation. A certificate must be trusted by Windows/Teams and match `localhost`.
Port `3979` avoids colliding with an existing HTTP preview on `3978`.

Alternatively, after **separately approving/configuring** an HTTPS ingress/tunnel
that already forwards to the selected loopback port:

```powershell
.\scripts\run-teams-local.ps1 `
  -Origin https://YOUR-ACTUAL-APPROVED-HTTPS-HOST `
  -LocalPort 3979 `
  -ConfigPath .\apps\teams\.env.local
```

With a configuration file, set its mode explicitly. Live mode additionally needs
the existing approved credentials, disclosure/Foundry configuration, package ID
and bot ID. Relative configuration paths are resolved against the repository
before the extracted runtime starts. The runner forces the **local** profile and
loopback binding; source user permissions remain delegated and unchanged.
Loopback sample testing does not establish colleague or cloud-callback reachability.
Live Teams packages require the approved shared HTTPS origin rather than a
development/template origin.

Stop a runtime started by this script:

```powershell
.\scripts\run-teams-local.ps1 -Stop
```

The runner records its exact PID, start time, runtime path and ownership marker.
Reruns replace only a verified runner-owned process after successful builds.
It refuses occupied ports belonging to unrelated servers and refuses reused PIDs.
Private configuration remains at the original environment-file location, never
inside either ZIP. Data and per-run privacy-safe logs remain under
`%LOCALAPPDATA%\TLC-Assist\Teams\launcher` unless `-WorkDirectory`/configured data
paths override them. Old release folders are retained for inspection; remove only
specific stopped releases after following the backup/update procedure below.

`-SkipBuild` reuses verified existing archives; optional `-RuntimeArchive` and
`-TeamsArchive` then select explicit files. URL/domain/mode/identity consistency
is still checked. `-SkipTeamsUpload` is for local verification and does **not**
report a successful installation; it does not skip HTTPS validation.

If `atk` is absent, the script invokes the pinned official
`@microsoft/m365agentstoolkit-cli@1.1.18` through `npm exec` with package install
scripts disabled and CLI telemetry off. This may need internet access and your
normal Microsoft 365 login. It does not call `provision`, create a bot, modify an
Entra registration or request a tenant-wide catalog publication. See Microsoft's
[Agents Toolkit CLI install command](https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/microsoft-365-agents-toolkit-cli#atk-install).
The separately installed `teams` Developer CLI is not a substitute: its manifest
upload command updates developer metadata rather than sideloading this ZIP.

HTTPS failure stops the new runtime and prevents upload, rather than installing a
package known to show a blank window. An upload/login/policy failure is surfaced;
the already verified runtime remains tracked/running for inspection and can be
stopped with `-Stop`. No success is inferred from merely opening Teams or from
the ZIP existing. Actual rendering and corporate live access remain client gates.

### Correct a stale Teams URL or a closed test URL

The local development package defaults to `https://localhost:3979`, matching the
trusted HTTPS runner example above. Its tab `contentUrl` and **Go to website**
`websiteUrl` must use that exact running origin.

- `http://127.0.0.1:3978` is the F5/browser-only HTTP preview. Opening that
  listener as `https://localhost:3978` produces `ERR_SSL_PROTOCOL_ERROR`;
  trusting another certificate does not turn an HTTP listener into HTTPS.
- A random high port printed during `tls-hosting.test.ts` belongs to a temporary
  test listener. The test closes it on completion, so opening that URL later
  produces `ERR_CONNECTION_REFUSED`. It is not the installed app's backend.
- Keep the persistent runner up at `https://localhost:3979`. Verify it with
  `Invoke-RestMethod https://localhost:3979/api/health`; expect `status: ready`,
  `surface: teams`, and the intended data mode.

Package version `0.1.2` distinguishes the corrected development URLs from the
earlier `0.1.1` installation. To refresh only the installation ZIP without
stopping or rebuilding a working backend:

```powershell
npm run teams:package:development -- --origin https://localhost:3979
```

Update the existing personal Teams app with the new
[`TLC-Assist-Teams-development.zip`](../../release-teams/TLC-Assist-Teams-development.zip).
Use the current repository output, not an older download. If Teams still opens
port `3978`, its installed metadata is stale: update the custom app in Teams, or
remove that old personal installation and upload this ZIP again, then reopen the
app. The package retains the same application ID. Merely rebuilding a ZIP does
not update an already installed Teams app, and sideloading does not start the
backend.

An existing installation can also keep `https://localhost:3978` if its backend
actually serves trusted HTTPS there. Stop your own HTTP-only Teams preview
first, then run the TLS runner with that exact origin. Use a separate
`-WorkDirectory`, such as `$env:LOCALAPPDATA\TLC-Assist\Teams\launcher-3978`, if
retaining the `3979` runtime. This changes the local listener, not Teams
permissions or installed metadata; it does not require a new Teams sign-in.
Never stop an unrelated process or try to share one port between HTTP and HTTPS.

After adding a trusted development certificate, restart an already-running Teams
client if its embedded browser still has stale certificate trust, then reopen the
app. The client keeps the SDK's actual frame context: tab configuration save hooks
run only in `FrameContexts.settings`, not in the personal app's content frame.
Opening **Context settings** in the personal workspace must not call those
settings-only APIs or blank the app. Client fixes require a rebuilt runtime/UI,
not merely an updated manifest ZIP.

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
Graph or Foundry. Default state and sample data persist outside the release
directory under `%LOCALAPPDATA%\TLC-Assist\Teams\sample`; test launchers use
in-memory stores. Existing explicit state/sample path settings remain supported.

### Run the downloaded runtime yourself

1. Extract `TLC-Assist-Teams-runtime-win32-x64.zip` to a versioned local folder.
   Install compatible Node first; the archive includes production dependencies,
   not the Node executable. No Windows Service installation is required.
2. For a sanitized local browser run, open PowerShell in that folder and run:

   ```powershell
   npm start
   ```

3. For explicit sample or live configuration:

   ```powershell
   if (Test-Path -LiteralPath .\runtime.env) {
     throw 'runtime.env already exists. Keep and edit the existing configuration.'
   }
   Copy-Item -LiteralPath .\runtime.env.example -Destination .\runtime.env
   # Edit runtime.env with the chosen mode/profile and approved settings.
   npm run start:configured
   ```

   `npm start` reads the process environment only. `start:configured` additionally
   loads `runtime.env` using Node's environment-file support; existing process
   variables take precedence. Never paste secrets into the command line or logs.
   Empty process variables also take precedence; remove unwanted overrides using
   `Remove-Item Env:TLC_TEAMS_MODE` rather than setting them to an empty value.
   In the repository, copy [the example](../../apps/teams/.env.example) to the
   ignored `apps\teams\.env.local` and use `npm run teams:start:configured`.
4. Open the printed loopback address for browser-only testing. Readiness must
   identify the Teams surface at `/api/health`. Stop normally with **Ctrl+C**, or
   Stop Debugging for F5. Wait for the process to exit before backup/update.
5. Restart with the same configuration, data directory and live state key.
   Durable state survives; users reauthenticate, and active workflow executions
   are not claimed to resume transparently.

Sample mode is a sanitized shared demonstration principal, not proof of real
multi-user sign-in or authorization. It must not be used with real customer data.
Use live mode and the existing FTE/delegated boundary for colleague access.

### Complete F5-to-Teams development path

1. **Only after exposure is approved**, obtain an HTTPS tunnel or ingress forwarding to local port `3978`.
   Use your organization's supported development-tunnel tooling and access policy.
   No launcher/package command creates a tunnel, changes firewall/router settings,
   or opens a LAN listener automatically. Keep app-level API/bot/callback validation
   even if the ingress endpoint is publicly reachable.
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
This F5 launcher explicitly selects the **local** profile and enables SQLite on
the supported Node versions. It does not attempt managed identity on the laptop.

### Reachability, uptime and URL lifecycle

As Microsoft's [local tunnel guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/developer-tools/local-tunnels)
explains, tabs load URLs from the user's client; bots, message extensions and
Graph callbacks can originate from Microsoft servers. Your private localhost
address is not reachable from colleagues' devices or those services. A trusted
local certificate alone does not make localhost a shared host.

An approved HTTPS ingress/tunnel is an **opt-in development/test transport**, not
production availability. A tunnel's separate login wall can block cloud callbacks;
its access policy needs approval while app protocol/JWT checks remain enabled.
No tunnel is launched or exposed by this implementation. An anonymous ingress
transport, if required and separately approved, must never mean anonymous business
data access.

The laptop, Node process, approved ingress and internet connection must stay up.
Sleep, lid close, shutdown, network/VPN changes or expired tunnel sessions interrupt
clients, callbacks and renewals. On return, reconnect, reauthenticate and reconcile
existing transcripts/unknown effects; do not replay writes to make up for downtime.
Delayed callbacks do not confer fresh source authority. A later hosted deployment
can improve endpoint stability/uptime but still needs operational acceptance.

Prefer an approved stable hostname for repeat tests. If it changes, update all of:
`TLC_TEAMS_ORIGIN`, SPA-B popup/broker registrations, Bot-C messaging endpoint,
Graph subscription notification origin, manifest URLs and `validDomains`.
Regenerate/reinstall the correct Teams ZIP; retire old subscriptions/configuration.
Do not assume an old installation follows a changed laptop URL automatically.

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
npm run teams:package -- --mode live --origin https://YOUR-APPROVED-TEAMS-HOST --app-id APPROVED-TEAMS-APP-GUID --bot-id APPROVED-BOT-C-GUID --verify-origin
```

The CLI validates the pinned official Teams 1.30 schema, capability-dependent
requirements and ZIP structure. The
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

### Teams upload validation: channel features and stage consent

App package version `0.1.1` fixes two requirements that structural JSON-schema
validation alone did not enforce:

- All current packages declare root-level `"supportsChannelFeatures": "tier1"`
  because their configurable tabs support `team` scope with manifest v1.30.
  The retired `supportedChannelTypes` field must not be used for v1.25+.
- Every package advertising `meetingStage`, including the sample/development
  package, declares
  `authorization.permissions.resourceSpecific` with
  `{ "name": "MeetingStage.Write.Chat", "type": "Delegated" }`.
  The sample does not request live application membership permissions or invent a
  bot/SSO identity. Live packages retain their two existing resource-specific
  membership permissions in addition to the delegated stage permission.

See Microsoft's
[channel manifest guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/build-apps-for-shared-private-channels)
and [meeting-stage manifest requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/build-apps-for-teams-meeting-stage).
The packager now rejects missing/wrong channel declarations and absent/wrong-type
stage permissions before writing a ZIP, as well as during official validation.
Standard/private/shared-channel runtime acceptance is still required; a manifest
declaration does not prove live membership or disclosure authorization.

If Teams reports either missing-property/permission error, regenerate the ZIP and
upload the newly generated package, not an old copy from Downloads. Version
`0.1.1` lets Teams distinguish it from the earlier `0.1.0` package. No backend
restart is required for this metadata-only correction. The development package
still needs the approved reachable HTTPS origin before actual Teams use; fixing
these manifest errors does not start a server or approve/expose a tunnel.

The delegated stage declaration does **not** remove the fail-closed live
meeting-audience check or grant MSX/Dataverse/Graph source access.

### Runtime distribution

```powershell
npm run teams:release -- --development
```

This builds the runtime, reruns cumulative tests, creates the explicitly labeled
development app package, and builds
`TLC-Assist-Teams-runtime-<platform>-<architecture>.zip` separately.
For a configured package, supply the real origin/IDs instead of `--development`.

The runtime ZIP includes production dependencies for the packaging platform.
When the selected host platform differs, restore the included locked production
dependencies using `npm ci --omit=dev` on the target platform. A Windows-native
dependency tree is not advertised as a Linux deployment.

The runtime also contains `runtime.env.example` and the deliberately unusable
disclosure-policy example. These are templates, not real credentials or an approved
policy. `npm start` does not automatically load them; copy/edit `runtime.env` and
use `npm run start:configured`, or supply settings through a protected process
environment. Keep real files out of the distribution.

## Configuration profiles: local now, Azure later

Set `TLC_TEAMS_MODE=sample` or `live` independently from
`TLC_TEAMS_RUNTIME_PROFILE=local` or `azure`. Local is the unhosted default; App
Service identifies the Azure default, but deployments should configure it explicitly.
Neither choice weakens live JWT/FTE, source authorization or reviewed writes.

| Concern | Local profile, Windows dev/test | Azure profile, future deployment |
| --- | --- | --- |
| Runtime | Same compiled Node service/UI; loopback by default | Same service/UI behind approved TLS ingress |
| Live durable state | SQLite file; no Table service required | Explicit `TLC_TEAMS_STORAGE_URL` and precreated `TlcTeams` table |
| Foundry workload credential | `AzureCliCredential`, pinned to the Foundry tenant in approved Foundry configuration | `ManagedIdentityCredential`, optionally user-assigned using `AZURE_CLIENT_ID` |
| Source identity | Each authenticated FTE's resource-specific A OBO tokens | Exactly the same delegated per-user path |
| Secrets | Protected local environment/config and stable state key | Protected host settings/secret facility and stable credential-state key |
| Availability | Limited by laptop, process, ingress and network uptime | Host-managed availability, still subject to operational validation |
| Teams package | Approved reachable test HTTPS origin | Deployed HTTPS origin; regenerate/reinstall for origin changes |

For local/live Foundry calls, install Azure CLI, sign in to the Foundry tenant
using your organization's approved procedure and obtain its project role. The CLI
credential is only the agent workload identity; no source connector borrows the
laptop owner's CLI MSX token. No fallback chain silently switches to another
credential. Local CLI login/Foundry grants still require real corporate setup and
have not been live-verified by offline tests.

Live local state requires a stable, random **32-byte Base64**
`TLC_TEAMS_STATE_KEY`. Payloads are AES-256-GCM protected with partition/key/revision
binding and a distinct derived encryption key; SDK token state remains encrypted
as well. The key is validated when reopening state. Missing/wrong keys fail closed;
there is no plaintext, in-memory or empty-store recovery fallback. Logical document
limits stay unchanged. Tenant/user isolation and CAS claims apply on SQLite too.
Row addressing/metadata still needs filesystem ACLs and approved disk protection.

The default live directory is
`%LOCALAPPDATA%\TLC-Assist\Teams\live\<tenant>\<environment>`.
`TLC_TEAMS_DATA_DIR` selects a different protected root; explicit
`TLC_TEAMS_STATE_PATH` remains supported, but live `:memory:` is rejected. Keep
the key/config separate from that directory. Do not put live state in the checkout,
release staging folder, a shared consumer-sync folder or a distribution archive.

For Azure later, explicitly configure the Azure profile, host origin/listener,
managed identity/Foundry role, Table endpoint/data role and secure settings. It
does not silently create storage/resources. There is no automatic SQLite-to-Table
migration: quiesce and reconcile before an owner-approved migration, especially
claimed/unknown actions and delivery records. Do not start with a blank table as
though existing effects had never occurred. Use a controlled single-runtime pilot;
active workflow execution is in process, not distributed resume.

These settings preserve a deployment path; they are **not** a completed Azure
readiness assessment or a deployment. No provisioning/deployment is performed here.

### Acceptance by environment

| Stage | Acceptance | Evidence boundary |
| --- | --- | --- |
| Local sample/runtime | Foreground configured startup, UI/API, shared workflows/guidance, reviewed sample changes, durable restart and stopped backup/restore | Verified offline/native/browser; no live source or Teams admission implied |
| Local live wiring | Encrypted durable state, tenant-pinned Foundry CLI selection, no mandatory Table/managed identity, unchanged API FTE/delegated checks | Synthetic live startup and unsigned-user denial verified without external calls; real corporate credentials/grants unverified |
| FTE colleague/Teams test | Approved reachable HTTPS origin, independent FTE sign-in and native source allow/deny, actual tab/bot/message-extension/callback behavior | Requires explicit ingress and tenant setup; no exposure or real multi-user test performed |
| Later Azure deployment | Same runtime with approved origin, managed identity/Foundry role, Table/state migration, secrets and operational checks | Configuration selection tested; infrastructure, migration, deployment and live operational readiness not verified |

## Logs, backup, updates and recovery

- Console logs contain safe event codes, category/method and correlation IDs.
  Startup reports the selected profile/store, not credentials, user/customer IDs,
  prompt/transcript text or private filesystem paths. Protect and rotate any
  redirected logs; do not enable SDK HTTP/body/token debug logging for live data.
- Stop with Ctrl+C before a consistent backup. Copy the **entire stopped data
  directory** to approved access-controlled/encrypted backup storage; keep its
  matching key and protected configuration separately. Include any SQLite
  sidecars if present. This is a local-file procedure, not a Table backup claim.
- Before updating, pause new work, reconcile already-sent effects, stop, backup,
  extract the new runtime into a new versioned folder and retain the same external
  data root/key. Never overwrite live state or include it in a new release ZIP.
  Recheck the actual UI/API and configured origin before allowing colleagues back.
- Restart retains admission, preferences, bindings, reviews, claims, receipts,
  acquisition/outbox metadata and sample writes. Private delegated sessions and
  in-memory active workflows do not transparently resume. Reauthenticate; unavailable
  runs are marked interrupted, and unknown effects are reconciled rather than retried.
- Restore first with `TLC_TEAMS_ADMISSION=read-only`. An older database can contain
  stale approvals/claims, so reconcile external effects and invalidate stale work
  before explicit resume. Restoring files or rolling back code never undoes MSX
  writes, Teams posts or disclosures. A lost key is not recovered by generating
  another key or deleting the database.
- Ordinary stop/start needs no Windows Service installation. Avoid simultaneous
  copies of the runtime owning one data directory; multi-instance claims are tested,
  but execution affinity and production scale-out are not thereby established.

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
| State | Local: protected durable SQLite and matching encryption key. Azure: configured/precreated Table and managed-identity role. Both require private partitions and approved retention/deletion/restore/audit access |
| Credential-state key | Secure 32-byte Base64 key in `TLC_TEAMS_STATE_KEY`; AES-GCM protection, rotation and reauthentication procedure |
| Foundry | Approved environment/project role; local uses tenant-pinned Azure CLI, Azure uses managed identity; neither is the source user's MSX identity |

Treat A, B, C, the Teams catalog package ID and the workload credential as
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
approved live writes, approved HTTPS ingress, interactive F5 in Teams, and operational
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
restart the selected runtime. Authorized reads and workflow cancellation remain;
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

### Current local-now, Azure-later handoff evidence

| Check | Result |
| --- | --- |
| `npm run phase0:check` | Passed: 155 files, 929 tests passed, 15 skipped; structure, sample preflight, lint and strict typing passed |
| `npm run teams:typecheck` | Passed |
| `npm run test:teams` | Passed: 31 cumulative files, 191 tests, including existing meeting regressions, manifest requirements, TLS and native runner cases |
| `npm run test:smoke:teams` | Passed: nine real-browser journeys, including pause/resume, exact DOCX/EML contents and isolated tracing-snapshot probes |
| `npm run validate:major` | Passed, including Desktop build and preview smoke |
| Earlier broad existing-surface regression, `playwright.revamp.config.ts` | Prior implementation run exited successfully with `--retries=1`: 106 first-pass tests and two flaky tests passing their retry (108 total); current profile changes also passed the major/Desktop preview gate |
| Earlier `npm run ext:build` / `npm run web:build` | Passed before profile alignment; no UI imports/components changed in this alignment |
| `npm run teams:release -- --development` | Passed end to end: build, cumulative tests, script-disabled production dependency restore and both ZIPs |
| Installation package | Official 1.30 schema and exact three-file/CRC checks passed; sample/live fixture metadata validated, not installed in a tenant |
| App package v0.1.1 correction | Actual regenerated ZIP includes `supportsChannelFeatures: "tier1"` and delegated `MeetingStage.Write.Chat`; capability validation explicitly rejects both previously missing declarations |
| Runtime archive | Windows x64 production dependencies, required entries, CRC and private-file exclusion checks passed |
| Staged runtime production dependency audit | `npm audit --omit=dev --prefix release-teams\runtime --json` reported zero known advisories; this is a point-in-time dependency check, not a security certification |
| Extracted configured runtime | Env-file startup outside the repository with module fallback disabled: UI/assets, accounts, grounded sample guidance, completed workflow, automatic transcript drafts without source changes, real DOCX/EML, confirmed sample writes/admission surviving process restart, stopped backup/restore and enforced read-only recovery passed; all owned processes and temporary state cleaned up |
| Actual local live-mode startup | Synthetic A/B/C/Foundry configuration, encrypted local state, no external resource requests and no Table dependency; health reported live, unsigned session/source-operation requests returned 401 |
| Local encrypted state/recovery | Full 48,000-byte logical limit, partition/key/revision authentication, cross-user isolation, conditional writes, matching-key stopped-backup restore and wrong-key rejection passed |
| Diagnostics privacy | Actual local request tests verified prompt/source-note/token input and private data-directory names were absent from captured runtime console logs |
| One-script pipeline | Actual rebuild/package plus extracted runtime/configuration/HTTPS UI and account API/start/ownership-verified stop exercised; private test-client certificate trust only, with tenant upload mocked |
| Runner/TLS negatives | Eleven native PowerShell cases plus real TLS tests verify upload gating, no wrong-host package, no unrelated PID termination, no certificate bypass and no success-shaped upload failure |
| Upload CLI | Pinned ATK 1.1.18 `install --help` executed successfully with the exact documented flags; no corporate login/upload was performed by this validation |

The focused tests are
[runtime profiles](../../tests/unit/teams/runtime-hosting.test.ts),
[restart/privacy](../../tests/unit/teams/runtime-recovery.test.ts) and
[encrypted state](../../tests/unit/teams/encrypted-local-state.test.ts).
The [single-script tests](../../tests/unit/teams/local-runner.test.ts) mock build,
process and tenant side effects for failure cases; the separate native integration
check used the actual rebuilt/extracted TLS runtime. An ephemeral certificate was
trusted only by that check's client, never installed in Windows/Teams trust. The
first integration harness needed its public-certificate import and test-result
scope corrected; runtime TLS validation was not relaxed to make it pass.
The extracted-runtime check deliberately runs only sanitized sample data. Initial
smoke harness attempts exposed empty environment overrides and PowerShell REST
array wrapping; correcting those harness inputs produced the successful checks
above without relaxing configuration or request validation.

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
