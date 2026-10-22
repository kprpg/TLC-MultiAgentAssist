# TLC Assist for Microsoft Teams

## Recommended: guided Windows launch, installation and pairing

From the repository root in PowerShell **7.4+**, with Node **22.12+**:

```powershell
.\scripts\run-teams-local.ps1 -Mode live     # Existing corporate CLI user
# Or: .\scripts\run-teams-local.ps1 -Mode sample
```

Prepare the private CLI configuration and trusted localhost PEM certificate/key
once as described below. The normal launcher now carries the sequence through
**both** the backend and the installed Teams client:

1. Build/test the backend and browser client, and package the Teams app for the
   exact same origin and app ID. A normal build gets a new numeric app version so
   Teams can update the existing app rather than silently reuse old metadata.
   Its personal-tab URL carries that version; a cached/old installed manifest
   cannot pass verification merely by loading a newly rebuilt backend.
2. Start the extracted backend and verify trusted HTTPS, HTML, API, data/auth mode,
   process ownership, unique backend run and exact browser build.
3. Install/update the exact three-file ZIP for your signed-in Microsoft 365
   account, then open that app's **My work** personal tab inside Teams. A failed
   CLI upload offers retry or guided manual custom-app upload of the exact ZIP;
   use `-ManualUpload` to select that manual route without attempting CLI sign-in.
   Tenant policy and sign-in still require your participation.
4. In local Live mode, type **CONNECT** in PowerShell to explicitly authorize the
   existing read-only MSX identity checks. Nothing signs in or reads MSX merely
   because the backend started. No setup step writes MSX.
5. Inside **Teams**, select **Request local pairing**. Expand **Backend
   connection**, check the displayed backend/run against PowerShell, and enter
   that page's exact eight-character code in the guide. It never selects or
   auto-approves some other pending page. When resuming an already paired page,
   press Enter as offered to verify its fresh acknowledgement without reconnecting
   or trying to approve an already consumed code.
6. Keep the Teams app visible. The guide waits for that authenticated page to
   acknowledge the exact backend run and compiled client build. Only then does
   it print **VERIFIED** and **Ready: True**. An open browser preview, a successful
   upload command, an approved-but-unredeemed code or a stale client is not success.
   Both Teams iframe hosts and native frameless webviews use the Teams SDK
   handshake; a native Teams window is not treated as a standalone browser.

Check or finish the **same** run without rebuilding, restarting or losing pairing:

```powershell
.\scripts\run-teams-local.ps1 -Status
.\scripts\run-teams-local.ps1 -Resume
.\scripts\run-teams-local.ps1 -Resume -Reinstall  # Re-upload this run's exact ZIP
.\scripts\run-teams-local.ps1 -Resume -Reinstall -ManualUpload  # Upload through Teams, not the CLI
.\scripts\run-teams-local.ps1 -Stop
```

Always include the original `-WorkDirectory` when you used a non-default location.
`-Status` is read-only and works while the guide is waiting in another terminal.
It checks the actual PID/start time and HTTPS runtime identity, not just whether
something listens on the port. It separately reports backend readiness,
installation state, owner/source connection and the Teams client. Client proof is
an in-memory heartbeat, expires after 30 seconds without a visible client, and
in local Live mode is also invalidated by page expiry/revocation or owner changes.
An inactive/hidden Teams tab is reported as waiting, not silently assumed healthy.
The **Backend connection** panel in Teams shows origin, mode, app version, backend
run, client build and client host, and makes stale-build/backend failures visible.

Failures and pauses leave the verified backend tracked and running. Use `-Resume`
to continue; do not rerun a full build just to retry login, upload or pairing.
The launcher retains a SHA-256-checked copy of the exact install ZIP beneath its
private per-run package directory, so another build cannot change what resume
uploads. Older launcher records without build identity require one normal rebuild;
their owned processes can still be stopped with `-Stop`.

If the normal launcher stops during **[1/7 and 2/7] Building and testing**, no
new client has been installed. Fix the reported build/test failure and rerun the
original launch command; `-Resume` reuses an existing packaged run and cannot
load changes that have not passed the build/test gate. Launcher tests read the
underlying PowerShell exception message directly so terminal-width wrapping and
colored error formatting cannot cause a false release failure.

### Manually deploy TLC Assist into the Teams environment

Use this route to install or update the Teams personal app through the signed-in
Teams desktop client instead of the Agents Toolkit CLI. The walkthrough below is
for **local Live**; Sample mode skips source connection and local pairing. To
resume, the backend must already be running and recorded by the launcher:

```powershell
.\scripts\run-teams-local.ps1 -Resume -Reinstall -ManualUpload
```

Include the original `-WorkDirectory` if you used a non-default location. This
resumes the same backend without rebuilding or restarting it. `-ManualUpload`
also works on a normal launch, and explicitly requests installation even when a
previous upload was recorded as successful. Do not combine it with `-NoGuide`,
`-BackendOnly` or `-SkipTeamsUpload`.

1. **Upload the exact retained ZIP.** The launcher displays the package version
   and hash-checked ZIP path, then opens its containing folder. In your signed-in
   **Teams desktop client**, select **Apps > Manage your apps > Upload an app >
   Upload a custom app**. Select only the ZIP printed by the launcher, not the
   runtime ZIP or a package from another build. Accept **Add/Update**.
2. **Confirm installation in PowerShell.** Only after Teams accepts that ZIP,
   type **INSTALLED** at the prompt. Anything else pauses setup and retains the
   backend. The launcher then opens the installed personal app in Teams and
   prints the expected backend origin, app version and backend run.
3. **Authorize source connection when prompted.** Type **CONNECT** to authorize
   the checks of your own MSX identity using the configured authentication
   profile. These setup checks do not write MSX records. An already connected
   source does not need to reconnect.
4. **Pair the page displayed inside Teams.** Select **Request local pairing** if
   not already connected. Expand **Backend connection** and compare its backend
   origin/run with PowerShell. Enter that Teams page's exact eight-character
   pairing code in PowerShell. Do not use a code from a standalone browser,
   another page or an example transcript. When resuming an already paired page,
   use the offered Enter option to check its fresh acknowledgement instead.
5. **Wait for verified completion.** Keep the Teams app visible until the guide
   reports `Installation: verified`, `Source: connected`, `TeamsClient: verified`
   and `Ready: True`, followed by **VERIFIED**. Upload confirmation or pairing
   approval alone is not completion. Use `-Status` to check the same run later.

The following is a sanitized example of the successful local Live flow observed
on **2026-10-20**. Personal paths and one-time pairing/run/build identifiers are
replaced with placeholders. The version, origin and timestamp are illustrative;
use the values printed for your own run, not the example values.

```text
[4/7] Installing/updating Teams personal app version 1.2484.26493. Exact ZIP: %LOCALAPPDATA%\TLC-Assist\Teams\launcher-cli\packages\<run-id>\TLC-Assist-Teams-local-live.zip
Manual upload selected. No Agents Toolkit CLI sign-in will be attempted; tenant custom-app upload policy still applies.
In your signed-in Teams desktop client: Apps > Manage your apps > Upload an app > Upload a custom app. Select ONLY: %LOCALAPPDATA%\TLC-Assist\Teams\launcher-cli\packages\<run-id>\TLC-Assist-Teams-local-live.zip
After Teams accepts that exact ZIP, type INSTALLED; anything else pauses setup: INSTALLED
[5/7] Opening the installed TLC personal app in Teams: https://teams.microsoft.com/l/entity/<package-id>/tlc-personal?webjoin=true
Expected backend: https://localhost:3978. App version: 1.2484.26493. Backend run: <run-id>.
[6/7] Explicit source connection. This verifies your own MSX identity; it does not write source records.
Type CONNECT to connect this backend using your own account; anything else pauses setup: CONNECT
In the Teams app select Request local pairing if not already connected. Expand Backend connection and check the expected backend/run above.
Enter the exact eight-character pairing code displayed INSIDE Teams (Enter = check a previously paired page; Q = pause): <code shown inside Teams>
[7/7] Waiting for the matching, visible Teams client to acknowledge this exact backend and build...

Backend        : ready
Origin         : https://localhost:3978
Mode           : live
Authentication : local-azure-cli
AppVersion     : 1.2484.26493
RunId          : <run-id>
ClientBuild    : <client-build-id>
Installation   : verified
Source         : connected
TeamsClient    : verified
Ready          : True
CheckedAt      : 2026-10-20T16:28:04.6633525Z
Logs           : %LOCALAPPDATA%\TLC-Assist\Teams\launcher-cli\logs\<run-id>

VERIFIED: the latest packaged Teams client is connected to this exact backend. No MSX source write was performed by setup.
```

Manual upload skips only the installer's CLI sign-in. Teams custom-app upload
policy, the source identity check, explicit page pairing and matching-client
verification remain enforced.

### If CLI sign-in reports AADSTS530084

`AADSTS530084` means organizational Conditional Access token protection blocked
the installer's token request. It is not a damaged app ZIP or an MSX connection
failure. Repeating `-Reinstall` or deleting the Toolkit's `.fx\account` cache does
not resolve a token-protection policy denial. Do not weaken tenant policy or
copy tokens from another application.

If the CLI keeps opening sign-in windows, press **Ctrl+C** in its PowerShell
terminal, leave the verified backend running, and follow
[Manually deploy TLC Assist into the Teams environment](#manually-deploy-tlc-assist-into-the-teams-environment)
with the same work directory.

This uses Teams' own supported sign-in, not a Conditional Access bypass. Custom
app upload must still be permitted. If upload is unavailable or Teams itself is
blocked, ask your tenant administrator to inspect the sign-in's Conditional
Access and **Token Protection - Sign In Session** details using its timestamp
and correlation ID. Client broker support and device registration both matter;
the CLI error alone does not distinguish them. See Microsoft's
[Windows token-protection guide](https://learn.microsoft.com/en-us/entra/identity/conditional-access/deployment-guide-token-protection-windows)
and [manual app-upload instructions](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/apps-upload).

For automation/offline checks, `-BackendOnly` (alias `-SkipTeamsUpload`) verifies
only the backend and defers all client setup. `-NoGuide` additionally permits
unattended package upload, but explicitly does **not** claim a rendered/paired
Teams installation. `-ManualUpload` requires explicit confirmation and cannot be
combined with `-NoGuide` or `-BackendOnly`/`-SkipTeamsUpload`.
Use `-ClientTimeoutSeconds` (default 120, maximum 600) when
Teams takes longer to open. Hosted Live continues to use its own corporate
browser sign-in; local-owner connection/pairing is never substituted for it.

## Status and the local-owner / hosted runtime profiles

The Teams surface is implemented for local development and offline validation.
Corporate tenant admission, approved HTTPS ingress, Teams sideload/sign-in, and
actual MSX/MCP/Graph access require the gates below. A successful build or ZIP check does
not establish a working or production-ready Teams installation.

**Per-user native topology:** `TLC_TEAMS_AUTH_MODE=local-interactive` is the explicit
Windows-local live profile. Every user runs their own TLS backend, browser session,
native sign-in and encrypted state on their own machine. There is no shared TLC
backend, token broker or application-state store. Only the corporate sources and
identity infrastructure are shared. The existing hosted API/SPA/bot/OBO profile
remains separate; it is not a prerequisite for local native MSX.

**Existing CLI sign-in:** the additional explicit `local-azure-cli` profile reuses
the current user's Azure CLI sign-in for **private MSX access**. It needs no
new native/API/SPA/bot registration. It verifies the delegated source token and
the user's own Dataverse mapping, then loads their active deal-team accounts
automatically. Explicit `reviewed` write mode enables the same shared MSX
operations as Desktop, with exact review, approval, concurrency checks and durable
receipts. It does not infer FTE/publisher roles or enable Graph or shared
publication. MCP is a separate, explicit owner-enabled connection, not an
automatic consequence of MSX connectivity. The native/hosted gates are unchanged.

**Engineering validation is offline only.** Do not sign in, read, create, update or
delete real MSX/Dataverse records while validating these changes. Use the fixture
tests with `TLC_RUN_LIVE_SMOKE=0`. End users perform actual source reads/writes
themselves after launching, signing in and approving their page. Startup, packaging,
health checks and owner `Status` do not establish source access or modify MSX.

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

The following shared-service description applies **only to the separate hosted
profile**, not the per-user native topology. The audience includes other Microsoft FTE colleagues. After you start/configure
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

## Per-user Windows MSX using the existing CLI user

This profile addresses the default Portfolio read journey without requiring a
manually entered user ID or account list. The existing Azure CLI must already be
signed in as a corporate **user**, not a service principal. If it is not, the end
user runs `az login` themselves; the page, startup and tests never invoke login.

Copy [the CLI example](../../apps/teams/.env.cli.example) outside the repository
and release folders. Supply the actual tenant ID (the cached `az account show
--query tenantId --output tsv` metadata can identify it), existing approved MSX
resource and a stable environment identifier. Do not copy source tokens or native
client IDs. The package ID must match the installed/generated Teams manifest.

Use the existing trusted PEM files, keep the installed tab and backend on
`https://localhost:3978`, and stop only the previous launcher-owned runtime:

```powershell
$root = Join-Path $env:LOCALAPPDATA 'TLC-Assist\Teams'
$config = Join-Path $root 'configuration\cli.env'
$work = Join-Path $root 'launcher-cli'
$certs = Join-Path $root 'certs'

# Once the public CLI configuration is populated, stop the previous sample host.
.\scripts\run-teams-local.ps1 -Stop -WorkDirectory (Join-Path $root 'launcher-3978')
.\scripts\run-teams-local.ps1 `
  -Mode live -AuthMode local-azure-cli `
  -ConfigPath $config -WorkDirectory $work `
  -Origin https://localhost:3978 `
  -CertificatePath (Join-Path $certs 'localhost.pem') `
  -PrivateKeyPath (Join-Path $certs 'localhost-key.pem') `
  -SkipTeamsUpload
```

If switching from another installation, use **its actual work directory** for
`-Stop`; never kill a foreign listener. The launcher uses an owner/SYSTEM-only
work/control directory, private encrypted state and the personal local-live package.
Use `--local-azure-cli` for standalone packaging. An extracted runtime includes
`runtime.cli.env.example`. Only use `-SkipBuild` for already rebuilt/verified archives.
The installed personal tab can reuse the same origin; install/update
`TLC-Assist-Teams-local-live.zip` for accurate personal-only package metadata.

Startup verifies HTTPS, live mode and the exact CLI public profile **without
requesting any MSX token or records**. The **end user** then connects:

```powershell
.\scripts\teams-local-connection.ps1 -Action Connect -WorkDirectory $work
# In Teams select "Request local pairing", then approve its actual displayed code:
.\scripts\teams-local-connection.ps1 -Action Approve -UserCode A1B2C3D4 -WorkDirectory $work
.\scripts\teams-local-connection.ps1 -Action Status -WorkDirectory $work
```

The code above is illustrative; never approve a code that does not match your page.
Connect verifies a tenant-pinned signed delegated MSX token and calls `WhoAmI`,
then verifies the enabled `systemuser` maps to that token's Entra subject. No FTE
claim is derived from an email suffix. Pairing must match Teams' apparent tenant/user
when supplied, and only the owner approves it. After pairing, Portfolio automatically
uses the **Dataverse system-user ID**, not the Teams/Entra object ID, to filter
active `msp_dealteams`, resolve active opportunities and load distinct accounts.
Existing explicit Portfolio curation remains governed by the shared connector.

The CLI subject is reverified on each source dispatch; account changes revoke old
page access and invalidate prior reviews. The standalone runtime defaults to
`TLC_TEAMS_CLI_WRITE_MODE=read-only` when the setting is absent. In that mode,
both the HTTP action gate and the source transport reject writes. Set
`TLC_TEAMS_CLI_WRITE_MODE=reviewed` or launch with `-CliWriteMode reviewed` for
Desktop-equivalent source operations: opportunity and milestone updates, stage
transitions, milestone activities, opportunity/milestone creation, team membership,
and the existing reviewed meeting changes. These reuse shared orchestrator and
connector paths, not a second Teams implementation. Native/hosted IAM role gates
are unchanged; the private CLI capability is not a manufactured app/FTE role.
Source row/field permissions still determine which actual operations succeed.
Every source mutation must go through preview and explicit approval; direct
operation calls cannot bypass review. Activity retains receipts; uncertain
outcomes must be reconciled, not blindly retried. Optional grants are not silently
replaced, CLI logout is never invoked by TLC disconnect, and failed/empty live
reads never fall back to sample records.
Public CLI configuration is version **1.2**, including the explicit `writeMode`;
native public configuration and
the protected owner/pairing protocol remain version **1.0**.

### Optional CLI MCP connection for live Plays

After connecting MSX and pairing the Teams page, the owner can separately enable
MCP using the current user's existing approved Dataverse permissions:

```powershell
.\scripts\teams-local-connection.ps1 -Action Connect -Resource mcp `
  -WorkDirectory "$env:LOCALAPPDATA\TLC-Assist\Teams\launcher-cli"
```

Use the same custom work directory as your launcher when applicable. This command
does not reinstall the Teams app, change registrations, grant tenant consent,
sign in through HTTP, or reset existing MSX pairing. The CLI uses the configured
Dataverse resource's `/.default` token path, verifies signature/tenant/audience
and delegated subject, and requires that subject to remain the already-verified
MSX owner. It does not borrow VS Code/native credentials or infer FTE roles.

In **Plays**, select **Check MCP connection** after the owner command. Until then,
the UI explains the missing connection and disables **Run workflow**; a direct
start request is also rejected before costly portfolio reads. MCP token
availability is not proof of MCP server/client allowlisting or query permission.
Actual calls still enforce the approved registry origin, default-deny tool
policy, query/row budgets and source-user permissions. If those grants/admission
are absent, the workflow reports failure/unauthorized source health rather than
pretending to complete. No source write is enabled by connecting MCP.

An ordinary optional-MCP acquisition/permission failure leaves a valid MSX
connection intact. Account changes, invalid identity, disconnect and source
expiry still invalidate the relevant authority. No optional MCP token is
requested before the explicit owner action, and Graph remains unavailable in
this CLI profile.

The Teams frame's initial cross-site `GET /` navigation can load the public
HTML shell, subject to the exact loopback Host and CSP frame-ancestor checks.
That bootstrap is not API admission: private/config API requests retain the
same-origin/fetch-site checks, and no pairing or source credential is granted.

## Per-user Windows native MSX

### Prerequisites and limits first

- An **approved native/public-client registration D**, corporate tenant, native
  loopback redirect and delegated MSX permissions. No API/SPA/bot client secret is
  required. A public client ID being present in Desktop configuration is not proof
  of approval. Desktop installations currently using Azure CLI do not silently
  become interactive-native installations; this profile never borrows CLI or
  VS Code first-party tokens.
- The native app's signed v2 ID token must carry the IAM-backed
  `TLC.Teams.User` eligibility role. Reviewed source effects additionally require
  `TLC.Teams.Writer` and actual source ACLs. Email suffixes, Windows ownership,
  unsigned Teams context and browser-supplied roles do not grant eligibility.
- REST access is distinct from Dataverse MCP's canonical `mcp.tools` grant and
  native-client allowlisting. Keep enabled MCP registry origins aligned with the
  configured MSX environment; a mismatched registry is rejected, not given a token.
- Deterministic guidance is explicitly selected by default for this new profile.
  It uses the same live-context registry as VS Code (`guidance-live-v1`), not sample
  agents or a claim of a Foundry response. Foundry can be explicitly configured
  separately; its workload credential is never an MSX credential.
- Private Portfolio, discovery, local preferences/history, MCEM, exports and
  reviewed actions use the shared core. Optional Graph reads require their own
  approved scopes and meeting permissions. No cloud Graph subscription is started.
- A different device cannot resolve this device's private binding/artifact IDs.
  Shared channels, stage/audience distribution, cloud bot/message extensions and
  private earnings-profile access remain explicitly gated in the capability panel.
  The local-live package advertises the personal workbench only; it does not make
  unsupported cloud/shared-surface promises or change the separate hosted package.
- Supported native installations use a non-reparse, owner/SYSTEM-only work/control
  directory beneath that Windows user's LocalAppData, with no outside-user-writable
  ancestors. Shared folders, redirected/reparse installations and central storage
  are not supported by this profile. Native sessions/refresh tokens stay in memory;
  the protected local state key persists separately from release binaries.

### Launch without source access, then let the end user connect

Copy the safe [native environment example](../../apps/teams/.env.native.example)
to a protected local configuration file outside the repository and release folder.
Replace its public coordinates with approved values; do not paste tokens or secrets.
For example, use the following **after** supplying that configuration and an already
trusted PEM pair:

```powershell
$work = Join-Path $env:LOCALAPPDATA 'TLC-Assist\Teams\launcher-native'
$config = Join-Path $env:LOCALAPPDATA 'TLC-Assist\Teams\configuration\native.env'
$certs = Join-Path $env:LOCALAPPDATA 'TLC-Assist\Teams\certs'
.\scripts\run-teams-local.ps1 `
  -Mode live -AuthMode local-interactive `
  -ConfigPath $config -WorkDirectory $work `
  -Origin https://localhost:3978 `
  -CertificatePath "$certs\localhost.pem" `
  -PrivateKeyPath "$certs\localhost-key.pem"
```

The launcher creates a fresh private work directory (or verifies an already private
one), prepares its persistent encryption key, builds
`TLC-Assist-Teams-local-live.zip`, and starts the matching loopback TLS runtime.
Frontend URLs, `validDomains`, listener origin and port must agree. The **native
OAuth callback port is separate**; do not force it onto the Teams HTTPS listener.
No sign-in, MSX query or source write is triggered by launch.
Use `-SkipTeamsUpload` when installation is already handled separately.

**The end user, not an unattended validation job**, then runs:

```powershell
.\scripts\teams-local-connection.ps1 -Action Connect -WorkDirectory $work
# Complete native corporate sign-in yourself. Connect verifies your own WhoAmI mapping only.
# In the Teams page select "Request local pairing", then approve its exact public code:
.\scripts\teams-local-connection.ps1 -Action Approve -UserCode A1B2C3D4 -WorkDirectory $work
.\scripts\teams-local-connection.ps1 -Action Status -WorkDirectory $work
# Optional, only after the separate native MCP grant/client allowlisting is approved:
.\scripts\teams-local-connection.ps1 -Action Connect -Resource mcp -WorkDirectory $work
# Optional Graph scopes must first be configured and approved:
.\scripts\teams-local-connection.ps1 -Action Connect -Resource graph -WorkDirectory $work
# Revoke the owner connection and all page sessions:
.\scripts\teams-local-connection.ps1 -Action Disconnect -WorkDirectory $work
```

`A1B2C3D4` above is an example, not a working approval. The owner command communicates
over a random local named pipe using a private owner-only control key, per-connection
nonces and mutually authenticated HMAC messages. It does not assume Node's default
named-pipe DACL alone is sufficient. No control key or source token is sent over HTTP.
Owner commands never write MSX/Dataverse records.

The page's memory-only S256 verifier is exchanged once after explicit owner approval
for an opaque API capability. Pending requests are limited to three/five minutes;
at most eight paired pages are admitted. A paired page now supports an **8-hour
work session**, with short API leases bounded by fifteen minutes and the verified
source credential. While the page is active, the client coalesces silent renewals
and revalidates the same signed source identity and its own Dataverse mapping.
Returning to an existing page after a short lease expires can renew it without
another pairing, provided that its original eight-hour deadline and source grant
are still valid. Renewal never opens sign-in, changes accounts, returns source
tokens to the browser or extends that original deadline.

Disconnecting, owner/account/role changes, failed source revalidation and backend
restart invalidate admission; reaching eight hours requires a fresh pairing.
The page token remains memory-only, with no browser storage or cross-device reuse.
Even an expired short lease can revoke its own page; it cannot read data until
successfully revalidated. The separate renewal contract is version **1.0**; the
existing owner/pairing protocol remains **1.0**. Reviews bind
the native/runtime generation; old responses and downloads cannot populate a newly
paired page. "Disconnect this page" revokes only that capability; the owner command
disconnects the whole installation. Reconnect/review after restart; never replay an
unknown source outcome.

An extracted runtime also includes `runtime.native.env.example` and the owner script.
Without the repository launcher, use its bundled entrypoint directly:

```powershell
node server.js --local-owner prepare "$work\private"
# Configure trusted TLS, exact origin/port and TLC_TEAMS_OWNER_DIRECTORY first, then start.
node --env-file=runtime.env --experimental-sqlite server.js
# In a second owner terminal:
node server.js --local-owner status "$work\private"
node server.js --local-owner connect "$work\private" msx
node server.js --local-owner approve "$work\private" A1B2C3D4
node server.js --local-owner disconnect "$work\private"
```

Native registration ownership, consent/Conditional Access, source grants, MCP
allowlisting and actual two-device behavior are **not verified by mocks, TLS or ZIP
checks**. Actual MSX read/write acceptance belongs to the end user; engineering must
not exercise live records.

## Portfolio selection and Discover responsiveness

After editing notes, stage or other opportunity fields, changing customer or
opportunity uses an **in-app** discard dialog rather than `window.confirm`, which
can be blocked in Teams frames. **Keep editing** retains the current customer and
draft; **Discard edits and continue** switches to the requested scope without
sending any source write.

Discover shows a loading state while its authorized source query runs, rather
than prematurely claiming no results. Hidden Portfolio account/opportunity/
milestone reads no longer run alongside it; a direct Discover visit makes only
the discovery operation. Errors are distinguished from an empty result and
**Refresh** retries that query without refreshing the hidden Portfolio.
Large live MSX searches can still take time; this change does not cache away
source-permission checks or broaden the selected solution-domain/account scope.

Source Opportunity values are preserved as signed, finite numbers. A negative
MSX amount must not reject an entire Discover domain, drop its opportunity or be
silently replaced with zero. An earlier read-contract constraint could report
`invalid request` after an otherwise successful Infrastructure query containing
such an amount; that was validation failure, not a timeout. The read wire shape
is unchanged, and new-record drafts retain their separate non-negative amount
constraints and explicit approval requirements.

Discover follows the VS Code extension's compact layout: eight Solution Engineer
domain tabs, **Add customer**, and a table with Opportunity, Account, Technical
capability, Stage and Action columns. Account, Stage and Action headers toggle
ascending/descending sort. Domain tabs support arrow keys, Home and End; narrow
Teams windows scroll the tabs/table horizontally rather than hiding customer data.

The shared **Customers equals all** / **Add filter** controls support customer
search, include (**equals**) and exclude (**does not equal**) selections, select
all matching customers, Apply/Cancel, removable filter chips and **Clear filters**.
The count reports the visible and total opportunities for the loaded domain.
Filters and sorting stay selected across domain changes and Refresh and work on
the already authorized results without additional source reads. A filter with no
matches is reported separately from a genuinely empty source result.

Use an opportunity's expand button to load its discoverable milestones on demand.
The same closed/cancelled/old-milestone visibility rules used by the other UIs
apply. **Add me**, **Remove me** and milestone-team toggles all open Teams' exact
change-review dialog; no membership changes before explicit confirmation.
Confirmed membership updates appear in the table without another discovery scan.

## Meeting Capture: paste/upload and meeting-link access

Select an account and opportunity in **Portfolio**, then open **Tools > Meetings >
Capture**. Choose **Customer meeting** or **Internal meeting** before extraction;
the existing customer/internal field-routing and sensitive-change gates still
apply.

### Paste or upload a transcript

1. Select **Paste / upload**. Paste WebVTT or `Speaker: text` lines into
   **Transcript text**, or choose a UTF-8 `.vtt` / `.txt` **Transcript file**.
   Word/PDF/binary files are not accepted; export VTT/text or paste their text.
2. Review the loaded text and classification, then select **Extract & Review**.
   Files are read locally first; their text is sent to the private backend only
   when you request extraction. Limits are **150,000 characters, 500 KiB and
   2,000 segments**. Invalid, empty, oversized and unsupported input is reported,
   not treated as a successful capture.
3. In **Follow-up**, inspect the grounded proposals and evidence IDs. These are
   private suggestions, not applied source changes. Manual input is explicitly
   labelled **user-provided evidence, not a Graph-verified meeting**; a pasted
   speaker label is not proof of that speaker's identity or meeting access.
4. Select the eligible changes, enter a **Meeting change reason**, and select
   **Review selected meeting changes**. Inspect the exact private review, enter
   its **Review reason**, then explicitly **Confirm selected changes**. Cancel
   sends no new changes. Read-only source profiles cannot commit writes.

Editing the supplied text or classification invalidates the previous displayed
proposal. Changing opportunity clears the draft and cancels pending client work
so a late result is not applied to a different opportunity. The backend retains
the bounded, parsed evidence in its protected per-user store for server-owned
review; it never logs transcript content or accepts client-authored proposals.
Review checks the stored evidence and current source permissions again and
preserves lifecycle, quota, source-version and exact-approval safeguards.

### Why a meeting join link may be unavailable

The **local-azure-cli** profile provides MSX access, not a delegated Graph
meeting grant. Capture defaults to **Paste / upload** for this profile. The
**Teams meeting** option explains this limitation and disables **Verify meeting
and acquire transcript**, rather than making a request that can only fail.
Being signed into Teams, installing the app, or enabling reviewed MSX writes
does not grant Graph meeting/transcript access.

Automatic lookup remains available only through a separately approved
Graph-enabled native/hosted profile with the appropriate delegated permissions,
consent, tenant transcript policy and actual meeting access. Missing Graph
connection/consent, access denial, administrator blocking, invalid links and
temporary acquisition failures now have distinct, actionable errors with their
correlation reference, rather than a generic `operation failed`. An optional
Graph-authentication failure does not discard a valid MSX connection.

Sample mode retains the bundled transcript picker and also supports
**Paste / upload** against the canonical sample store. No extraction path writes
MSX automatically, changes tenant policy, or treats manual input as Graph
authorization.

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
- The CSP permits the Teams SDK's exact public trusted-domain-list JSON URL, not
  arbitrary Office CDN connections. This bootstrap resource carries no MSX credentials
  and is separate from native/source authentication.
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

### Browsing cache and confirmed background synchronization

Teams keeps canonical browsing data in private browser memory, not in the shared
service runtime. Domain/customer filters remain local; loaded visible data can
quietly revalidate at the shared 5/30-minute policy. Scope/connection changes clear
data, and dirty notes/field editors survive a quiet refresh.

`TLC_BACKGROUND_SYNC=1` enables only capabilities supported by the existing protected
durable runtime store. In-memory state is not durable. The review dialog closes
after persisted admission; pending status remains visible while unrelated navigation
continues. Source confirmation, conflict and unknown effects are distinct.

Read-only CLI stays read-only. Current delegated identity, generation, writer roles,
native ETags and the server-owned meeting draft boundary are not bypassed. The new
receipt namespace does not replace existing reviewed-action history.

Use [the shared recovery and rollback procedure](../performance/performance-optimization.md#adaptive-freshness-and-confirmed-background-writes).
Set the flag to `0` without deleting protected runtime state to disable new background
admission while retaining private receipt reconciliation.

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

### One-script guided build, run, install and verify

Use [run-teams-local.ps1](../../scripts/run-teams-local.ps1) from PowerShell **7.4+**
in the repository. This is the single sample/live launcher:

```powershell
.\scripts\run-teams-local.ps1                         # Sample / Live menu
.\scripts\run-teams-local.ps1 -Mode sample            # No menu
.\scripts\run-teams-local.ps1 -Mode live              # Current CLI user; reviewed writes
.\scripts\run-teams-local.ps1 -Mode live -CliWriteMode reviewed
.\scripts\run-teams-local.ps1 -Mode live -CliWriteMode read-only
.\scripts\run-teams-local.ps1 -Status
.\scripts\run-teams-local.ps1 -Resume
.\scripts\run-teams-local.ps1 -Mode sample -BackendOnly
.\scripts\run-teams-local.ps1 -Stop
```

The menu defaults to **Sample** on Enter and chooses the initial data mode for
new pages. Invalid choices fail explicitly; Live never falls back to Sample when
configuration or authentication is unavailable. With an approved Live profile
already configured, the launcher prepares one Live-capable runtime even when
you start in Sample. Use the personal workbench's **Data mode** selector to switch
without restarting the backend, reloading the page or reinstalling the app. A
backend restart still requires a fresh owner-approved Live pairing.
Use ordinary invocation (`.\scripts\run-teams-local.ps1`) rather than dot-sourcing
the launcher into your current PowerShell scope. `-Mode` bypasses the menu;
`-Stop` needs neither a mode nor an origin.

If PowerShell reports that `.\scripts\run-teams-local.ps1` **is not recognized**,
check the repository location and branch before changing PowerShell settings:

```powershell
git branch --show-current
Test-Path -LiteralPath .\scripts\run-teams-local.ps1 -PathType Leaf
```

Run from the repository root; the path check must return `True`. During Teams
feature development, the launcher and this guide are on
`feature/vscode-extension-Teams`; `feature/vscode-extension` does not contain
them. If you are on that non-Teams branch, check `git status` and preserve any
uncommitted work before running `git switch feature/vscode-extension-Teams`.
Then rerun the launcher. A missing script is not an execution-policy,
authentication or Live-mode failure; do not copy the launcher alone onto a
branch without its Teams runtime dependencies.

`Origin:` used to be PowerShell's prompt for a missing mandatory parameter. It is
now optional. Resolution is **`-Origin` -> `TLC_TEAMS_ORIGIN` in the selected
configuration/environment -> `https://localhost:3978`**. If no origin is configured,
an explicit `-LocalPort` or configured `TLC_TEAMS_PORT` selects the default HTTPS
port instead. Origins must still be exact HTTPS addresses without paths.
Command parameters take precedence; environment-file values override inherited
environment values during inspection.

Live defaults to `local-azure-cli` unless `-AuthMode` or the configuration selects
another existing profile. Without `-ConfigPath`, it looks for
`%LOCALAPPDATA%\TLC-Assist\Teams\configuration\cli.env`. Prepare that file once
from [the safe CLI template](../../apps/teams/.env.cli.example), outside the
repository, and fill in the approved tenant, MSX resource and environment.
Do not supply tokens or invent configuration coordinates. The launcher defaults
to `reviewed` CLI write mode, honors a configured `TLC_TEAMS_CLI_WRITE_MODE`, and
accepts `-CliWriteMode read-only` or `-CliWriteMode reviewed` as an explicit override.
Selecting Live enables the reviewed-write capability, **not automatic writes**.
Backend startup never connects to MSX or initiates login. The guided finish asks
the owner for explicit CONNECT confirmation and exact page-code approval; each
source change still needs separate review. Sample also discovers an existing
private configuration so Live can be selected later in the same page; loading
configuration is not source sign-in, pairing or permission to read/write Live
data. The Sample-first guide skips source connection and page pairing entirely.
With no approved Live profile, Sample remains standalone and Live is unavailable.

#### Switch Sample and Live inside Teams

1. Open **My work**, the personal workbench, and use **Data mode: Sample / Live**
   in its header. The selector is also available before Live pairing, so you can
   explore Sample without signing in to a source.
2. Confirm **Switch mode and discard unsaved work**, or choose **Keep current
   mode** to retain the current draft. Switching clears the page's drafts, results,
   pending reviews and selected account/opportunity; it opens the target mode's
   Portfolio. The control is locked while a write confirmation is in progress.
3. Sample uses the canonical sanitized **SQLite** services shared with the other
   clients, not browser-only mock records. Sample edits, approvals and activity
   are separate from Live; no customer records, source credentials or Live page
   capability are sent to Sample requests.
4. First use of local Live still needs the configured source, explicit owner
   **Connect**, and the current page's code approval. If needed, use
   `teams-local-connection.ps1 -Action Connect` and `-Action Approve -UserCode`
   with the same protected `-WorkDirectory` used by the launcher. Selecting Live
   never performs either step on your behalf.
5. Returning to Live in the **same page** reuses an unexpired, still-authorized
   approval held only in memory; revoked/expired approval or a changed Teams
   identity/context requires authorization again. No capability is persisted in
   browser storage or a cookie. A recreated Teams webview still needs manual
   pairing; changing data mode does not alter that security choice.

The selection is per personal page, not a global switch: other pages, bound
channel/meeting surfaces and already-dispatched operations keep their original
mode. Switching does not cancel or undo a submitted workflow/write. Late results
from an old-mode client are discarded rather than appearing in the new mode.

The guided launcher keeps Sample records at
`<WorkDirectory>\data\sample\sample.sqlite`, normally beneath
`%LOCALAPPDATA%\TLC-Assist\Teams\launcher-cli`. In a Live-capable runtime, Sample
review/activity state uses the separate `sample.sqlite.state.sqlite` file.
These survive mode changes and backend restarts; Live state remains in its own
encrypted store. `TLC_TEAMS_SAMPLE_PATH` can override the Sample data path; keep
both Sample files distinct from `TLC_TEAMS_STATE_PATH`. Test-only `:memory:`
settings are not persistent.

For direct Node/configured startup, `TLC_TEAMS_MODE` remains the immutable runtime
profile. Set optional `TLC_TEAMS_INITIAL_MODE=sample` on a configured Live runtime
to open Sample first without source access. `GET /api/teams/modes` reports the
versioned initial/runtime/available modes; the canonical API retains the runtime
profile and explicit mode-prefixed routes use isolated services/stores. Backend
connection shows runtime identity and active page data mode separately. The
launcher's `-Status` records the initial data mode; it does not change or claim
the current selection in other open pages.

The launcher performs the requested sequence:

1. Rebuilds the backend/browser runtime ZIP and runs the cumulative Teams tests.
2. Rebuilds the three-file Teams installation ZIP for the **same** origin/mode.
3. Extracts a new versioned runtime beneath your local AppData, configures stable
   external data paths, starts Node, and verifies the local and trusted HTTPS UI/API.
4. Uses `atk install`, or guided Teams custom-app upload with `-ManualUpload`, to
   upload/sideload that exact ZIP for your Microsoft 365 account. Login, consent
   or tenant app-upload policy can still require interaction.
5. Opens the matching installed personal app, guides explicit source connection
   and page-code approval where applicable, and waits for its authenticated Teams
   client/build/run acknowledgement before reporting complete.

For same-laptop testing, prepare **real, existing, trusted** localhost PEM
certificate/key files once. When both TLS paths are otherwise absent, the launcher
discovers `%LOCALAPPDATA%\TLC-Assist\Teams\certs\localhost.pem` and
`localhost-key.pem`. Explicit parameters or configured TLS paths still take
precedence; partial pairs and missing paths fail. Paths such as `C:\YOUR_CERT_FOLDER\localhost.pem` and
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

With the trusted pair in that per-user directory, the short launch commands above
need no certificate parameters. To use another directory or port, launch explicitly:

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

Use the menu or `-Mode` to select the data mode. The separate **hosted-obo** live
profile still needs the existing approved credentials, disclosure/Foundry
configuration, package ID and bot ID; it is not the default local CLI profile.
Relative configuration paths are resolved against the repository
before the extracted runtime starts. The runner forces the **local** profile and
loopback binding; source user permissions remain delegated and unchanged.
Loopback sample testing does not establish colleague or cloud-callback reachability.
Hosted live Teams packages require the approved shared HTTPS origin rather than a
development/template origin; private CLI/native packages require loopback HTTPS.

Stop a runtime started by this script:

```powershell
.\scripts\run-teams-local.ps1 -Stop
```

The runner records its exact PID, start time, runtime path and ownership marker.
Reruns replace only a verified runner-owned process after successful builds.
It refuses occupied ports belonging to unrelated servers and refuses reused PIDs.
Private configuration remains at the original environment-file location, never
inside either ZIP. Data and per-run privacy-safe logs remain under
`%LOCALAPPDATA%\TLC-Assist\Teams\launcher-cli` by default for both Sample and CLI
Live. The common owner-protected work directory lets a mode switch replace only
the verified launcher-owned runtime on the same origin. Sample data remains in
`data\sample`; live state stays in the protected `private` directory.
`local-interactive` retains its separate `launcher-native` default.
Use `-WorkDirectory`/configured data paths to override these paths. For older
installations in `launcher` or other directories, stop them using their actual
`-WorkDirectory`; the launcher will not kill an unrelated listener.
Old release folders are retained for inspection; remove only
specific stopped releases after following the backup/update procedure below.

`-SkipBuild` reuses verified existing archives; optional `-RuntimeArchive` and
`-TeamsArchive` then select explicit files. URL/domain/mode/identity consistency
is still checked. `-SkipTeamsUpload` is for local verification and does **not**
report a successful installation; it does not skip HTTPS validation.

If a previous build failed with `ENOENT` for
`release-teams\runtime\.generated-teams-runtime`, the legacy staging directory
exists without the packager's ownership marker, possibly with only leftover
`node_modules`. Do not create the marker by hand or delete unknown contents.
The packager now uses a fresh `release-teams\.runtime-build-<unique>\runtime`
directory for each build and removes only that build's staging when finished.
Existing unmarked `release-teams\runtime` contents are left untouched and no
longer block packaging. Rerun the normal launcher; the runtime ZIP name and
Teams client/backend HTTPS origin and port are unchanged. This packaging error
occurs before backend startup and is unrelated to MSX sign-in or Teams pairing.

If `atk` is absent, the script invokes the pinned official
`@microsoft/m365agentstoolkit-cli@1.1.18` through `npm exec` with package install
scripts disabled and CLI telemetry off. This may need internet access and your
normal Microsoft 365 login. It does not call `provision`, create a bot, modify an
Entra registration or request a tenant-wide catalog publication. See Microsoft's
[Agents Toolkit CLI install command](https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/microsoft-365-agents-toolkit-cli#atk-install).
The separately installed `teams` Developer CLI is not a substitute: its manifest
upload command updates developer metadata rather than sideloading this ZIP.

The install call uses **`--interactive false`** so ATK honors the supplied
`--file-path`. ATK 1.1.18's interactive command mode discards this option, causing
`MissingRequiredOptionError` for `--file-path or --xml-path` even when a path
was passed. Non-interactive command selection does not bypass Microsoft 365
authentication, consent or tenant sideloading policy.

If an earlier launcher reached **Runtime ready** but failed at this final install
step, leave the backend running. From the repository root, retry only installation
of the already-built local CLI/native Live package:

```powershell
npm exec --yes --ignore-scripts --package=@microsoft/m365agentstoolkit-cli@1.1.18 -- `
  atk install `
  --file-path ".\release-teams\TLC-Assist-Teams-local-live.zip" `
  --scope Personal --interactive false --telemetry false
```

Prefer `.\scripts\run-teams-local.ps1 -Resume` for the recorded run: it uses the
retained, hash-checked ZIP and continues through opening Teams and pairing.
The standalone command above does not rebuild, restart or stop the backend. Supply the actual matching
Teams installation ZIP if using a different package; never upload the runtime
ZIP. Any Microsoft 365 sign-in or tenant approval still requires the end user's
participation. Source MSX connection and owner-approved page pairing remain
separate security gates; the guide now leads you through both after installation.

HTTPS failure stops the new runtime and prevents upload, rather than installing a
package known to show a blank window. An upload/login/policy failure is surfaced
with retry/manual-upload guidance; the already verified runtime remains
tracked/running for inspection and can be stopped with `-Stop`. No success is
inferred from merely opening Teams or from the ZIP existing. The guide requires
actual matching client acknowledgement, plus explicit owner/source confirmation
in local Live mode, before reporting VERIFIED. Corporate tenant admission and
real source permissions still cannot be bypassed by a launcher.

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

- Personal Portfolio/Discover, agent guidance, shared Plays, milestone/task
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

### Extension-aligned workspace

The personal app opens **Portfolio**, with the same **New | Discover | Portfolio |
Plays | Dashboards** vocabulary as the VS Code extension. **Tools** retains My
work, Meetings, Activity and Context settings; these are not removed features.

- Portfolio has a sortable account/opportunity scope pane, central **Overview /
  Guidance / MCEM Stages** detail tabs, and a role-based **Next Best Actions**
  pane. Overview leads with milestones and reviewed field/activity controls.
  Meeting capture opens the existing private acquisition/review workflow.
- The header search is limited to the viewer's accessible portfolio. Its keyboard
  suggestions select scope; it is not Teams global search. Pane buttons preserve
  unsent work, and switching away from dirty opportunity edits requests an
  explicit discard decision. Private drafts/results are not persisted in browser
  storage.
- One explicit MCEM evaluation supplies the stage view and recommendation rail.
  Recommendations remain read-only, with owner roles, evidence and assumptions.
- **MCEM Stages** uses the same shared five-column stage headings, accountable
  roles, cards and styling as Desktop/Web. It places the authorized account's
  opportunities by recorded stage. Select a card to retain the stage-board view
  while changing opportunity; bound tabs cannot escape their existing scope.
  Unevaluated cards say **Not evaluated**, not a permanent loading message.
  Evaluation remains explicit and scoped to the selected opportunity; it does not
  fan out model calls across every card. Adjacent stage changes retain the existing
  reason, exact-preview and confirmation gates below the board.
- Plays retains shared run/cancel/history semantics and displays structured
  result cards, queues, evidence and source health instead of a JSON-only result.
  Cards and notifications deep-link to the appropriate private Plays/Activity view.
- Plays distinguishes catalog/history loading, failures, empty results and
  workflow startup. **Starting workflow...** explains source-scope verification;
  no completed result is implied while the request is pending. Catalog/history
  failures have explicit retry controls, and failed runs keep their error reference.
  Workflow scope capture now shares one portfolio snapshot across its account
  reads instead of rereading the whole portfolio once per account. That memo is
  local to a single capture; subsequent requests and concurrent captures still
  recheck source visibility independently.
- New retains sample SQLite creation and reviewed live draft export. Dashboards
  reuses the shared sample Seller Dashboard. In live Teams it reports
  `hosted-profile-denied`; being on the same laptop does not authorize a viewer
  to read the operator's Windows earnings profile.
- At content widths below 1200 CSS pixels, actions/evidence become a labeled
  disclosure. Below 900 pixels, scope becomes a disclosure and content stacks.
  Wide views use three regions without requiring draggable blade widths.
- Bound tabs keep their account and, when present, opportunity binding. Search
  and unrelated personal destinations do not escape that scope.
- Meeting canvases expose **Prep / Capture / Follow-up**. SDK side-panel frames
  use the compact private surface without the full personal navigation. Settings
  APIs still run only in SDK settings frames. The shared stage renders only an
  approved artifact, never the private Portfolio or raw transcript.

Teams light/dark/high-contrast changes flow through Fluent tokens. The revision
includes keyboard tab navigation, labeled pane controls, responsive fixtures and
an isolated real-TeamsJS host handshake test; no new tenant permissions or agents
are introduced.

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

### Responsiveness and optional performance diagnostics

Portfolio now loads accounts, the selected account's opportunities and the
selected opportunity's milestones in one fresh shared-core capture. Its loading
state remains visible until that workspace read finishes. A denied read clears
the private result instead of falling back to previously displayed data.

The header search does not query MSX on focus. Type at least two characters;
after a short input debounce it requests one authorized portfolio index, not
one request per account. Returning to a screen still revalidates Live source
access. Identical concurrent browser reads can share their pending work, but
completed Live results are not a cross-request cache.

Composite snapshot, Guidance, MCEM and creation-catalog reads reuse a bounded
source context. CLI acquisition only coalesces concurrent requests for the same
owner generation; the next dispatch still rechecks the current CLI subject.
Independent/cancelled reads do not share pending source evidence. Discovery
queries use at most two 40-record chunks at once, retain deterministic order
and keep trusted paging checks. Running Plays poll less frequently as they
continue and do not poll while the page is hidden; every disclosed workflow
view still verifies its source scope.

Only content-hashed public assets are browser-cacheable. HTML, build identity,
configuration and private APIs remain `no-store`. Rarely used workspace code
loads on demand; a failed load shows explicit recovery guidance without silently
reporting an empty result. Existing page-pairing and exact build checks remain.

For an operator-controlled diagnostic run, set `TLC_TEAMS_PERFORMANCE=1` in the
private runtime environment before launching an updated build. It is disabled
by default. The backend emits `[teams-performance]` JSON events with only
`operation`, `durationMs`, `outcome` and, inside an HTTP operation, its random
`correlationId` (also returned as `x-correlation-id`). Credential acquisition,
source HTTP reads, context/agent phases and operation totals can be correlated
without logging prompts, responses, customer identifiers, financial values,
transcripts or tokens. Count source-read events separately from operation
events; their durations overlap and should not be naively added.

These code/test optimizations are not a measured native Teams or tenant latency
guarantee. See the [ranked assessment and implementation status](../engineering/Teams-Performance-Assessment.md#10-implementation-status)
for the verified request-count reductions, cross-surface changes and intentionally
retained security/freshness boundaries. An already-running release does not
change until the operator explicitly rebuilds/relaunches it.

The follow-up also optimizes the shared Live/SQLite backends: bulk portfolio
indexing, joined owner lookups, once-per-read intent labels, bounded membership
reuse and bulk workflow-scope captures. To reproduce controlled backend
measurements across all four host transports, run `npm run test:perf:backends`.
It uses read-only synthetic loopback sources and an isolated Electron profile,
not your source sign-in or tenant. See the
[backend comparison and measurement limits](../engineering/Teams-Performance-Assessment.md#11-shared-backend-follow-up-and-performance-measurements).

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
