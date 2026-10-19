TLC Assist Teams host runtime

Run this ordinary web application yourself: local dev/test now, Azure later.
For per-user native MSX, each user operates their own Windows installation.
Use runtime.native.env.example with explicit local-interactive authentication.
Or reuse the existing CLI user with runtime.cli.env.example and explicit local-azure-cli.
The CLI profile verifies signed delegated source identity and own WhoAmI mapping,
then defaults Portfolio to that user's active deal-team accounts. It is read-only.
CLI login does not grant FTE/writer/publisher roles, optional MCP/Graph or source writes.
The local-native Teams package declares private personal access, not cloud bots
or cross-device shared bindings/stage. The original hosted profile is separate.
Use trusted loopback HTTPS with manifest URLs and backend on the same port.
Prepare an owner/SYSTEM-only control directory without source access:
node server.js --local-owner prepare <protected-owner-directory>
Set TLC_TEAMS_OWNER_DIRECTORY to it and keep native data inside that directory.
Native ID tokens require approved IAM-backed TLC.Teams.User / Writer roles;
an email suffix or configured public client ID is not an eligibility grant.
After starting the runtime, the END USER explicitly connects and pairs:
node server.js --local-owner connect <protected-owner-directory> msx
node server.js --local-owner approve <protected-owner-directory> <page-code>
Status / disconnect use the same syntax with action status / disconnect.
Connect performs only source identity reads; no owner command writes MSX.
No source sign-in or data operation is triggered by startup or public HTTP.
All engineering validation is offline; end users exercise actual source data.
This runtime ZIP is not the manifest/icons ZIP to upload into Teams.
Uploading the Teams ZIP neither starts this server nor deploys Azure resources.
The bundled node_modules match the packaging OS and CPU. Restore dependencies
with npm ci --omit=dev on the destination platform when they differ.
Start a sanitized preview: npm start. Stop the foreground process with Ctrl+C.
For explicit configuration, copy runtime.env.example to runtime.env, then use:
npm run start:configured
Node environment variables take precedence over runtime.env; check mode/profile.
The default loopback listener does not open a firewall, LAN port or tunnel.
local profile: SQLite state, encrypted in live mode; no required Azure Table.
Live local Foundry access uses AzureCliCredential in the configured Foundry tenant.
In the hosted profile Azure CLI is for Foundry workload access only, NEVER a
substitute for a colleague's delegated source permissions or FTE admission.
azure profile: managed identity for workload access and configured Table Storage.
Native/hosted features retain their approved Entra/FTE and optional-resource gates.
The CLI read-only profile still requires delegated MSX permission and owner pairing.
runtime.env.example and config/teams-disclosure.example.json are safe templates,
not working live credentials or an approved disclosure policy. They are not auto-loaded.
Set TLC_TEAMS_ADMISSION=read-only to stop new work while retaining authorized reads.
No credentials or real Foundry environment configuration are bundled.

State and recovery:
Default local state is under LOCALAPPDATA\TLC-Assist\Teams\<mode>, outside this
release folder. Live state additionally separates the tenant and environment.
TLC_TEAMS_DATA_DIR can select an approved local directory. Keep its filesystem
ACLs limited to the operator and use approved disk encryption; row metadata is
not hidden by payload encryption. A live 32-byte TLC_TEAMS_STATE_KEY is required.
Keep the state key stable and back it up separately in an approved secret store.
Do not put secrets, live state or transcript data in a distribution ZIP.
For a backup: stop this runtime, copy its entire data directory to an approved
protected backup, and retain the matching configuration/key separately.
For an update: stop, backup, extract to a new release directory, retain the same
external data directory/key, verify privately, then restart. Never overwrite state.
Restart does not replay claimed writes; reconcile unknown outcomes. In-memory
workflows and delegated sessions do not transparently resume; users sign in again.
Restore first with admission read-only, reconcile receipts/external effects,
then explicitly resume. Restoring old state cannot undo external source writes.

Connectivity and logs:
Tabs need HTTPS reachable from their clients; bot/message-extension/Graph
callbacks need Microsoft-service reachability. Private localhost is insufficient.
An approved tunnel/HTTPS ingress is opt-in and is NOT launched by these commands.
Sleep, shutdown, network changes or a stopped tunnel make the app unavailable.
Keep origin, Entra redirect/broker configuration, bot endpoint, callback URL and
manifest URLs/validDomains consistent; regenerate/reinstall for origin changes.
Console diagnostics contain safe codes/category/correlation IDs, not prompts,
customer payloads, transcripts or tokens. Protect/rotate any redirected log files.
No Windows Service or automatic background installation is required.
