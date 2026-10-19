TLC Assist Teams host runtime

Run this ordinary web application yourself: local dev/test now, Azure later.
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
Azure CLI is for Foundry workload access only, NEVER a substitute for an FTE
colleague's delegated MSX/Dataverse/Graph permissions. Live app sign-in remains.
azure profile: managed identity for workload access and configured Table Storage.
Live mode still requires approved Entra/consent/FTE/MSX/MCP/Graph/Foundry setup.
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
