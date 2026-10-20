# TLC MultiAgent Assist

[![Continuous integration](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml)
[![Nightly desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml)
[![Desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml)
[![Web release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml)
[![VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml)
[![Nightly VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly-vscode-extension.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly-vscode-extension.yml)

TLC MultiAgent Assist is an account assistant that combines live MSX opportunity context with contextual guidance to help advance each opportunity. It has three established surfaces plus a Teams development surface from one codebase:

| Surface | What it is | Get started |
| --- | --- | --- |
| **VS Code extension** | TLC Assist inside VS Code or VS Code Insiders. | [Install](#vs-code-extension) |
| **Windows desktop app** | A packaged Electron app with Start menu and desktop shortcuts. | [Install](#desktop-app) |
| **Web application** | The same UI in the browser, hosted on Azure App Service. | [Run](#web-application) |
| **Microsoft Teams (development)** | Thin Teams UI/transport over the same core; run it yourself on Windows now, deploy the same runtime to Azure later. | [Setup, ZIPs and F5](docs/runbooks/teams-app.md) |

### Teams: local development now, Azure hosting later

The Teams-uploadable ZIP contains the manifest and icons, **not a running backend**.
You run the ordinary Node web application yourself on your Windows laptop for
development/test. The local profile uses durable SQLite (encrypted in live mode),
not mandatory Azure Table Storage or a laptop managed identity. The same runtime
has an Azure profile for later deployment; no vendor or other operator is assumed.
FTE colleagues authenticate individually and retain their own delegated source
permissions, not the laptop owner's access.

Use `npm run teams:start` for the local sanitized sample, or
`npm run teams:start:configured` after preparing the ignored local environment file.
Stop with Ctrl+C. Teams/colleague testing additionally requires approved reachable
HTTPS ingress; no tunnel, networking change or Azure resource is created by these
commands. Installing the Teams package neither starts the laptop server nor
deploys it to Azure.

For guided backend startup, exact-client installation **inside Teams**, source
connection and verified pairing, use the single
[local Teams runner](scripts/run-teams-local.ps1):

```powershell
.\scripts\run-teams-local.ps1                  # Sample / Live menu
.\scripts\run-teams-local.ps1 -Mode sample     # Skip the menu
.\scripts\run-teams-local.ps1 -Mode live       # Existing CLI user; reviewed MSX read/write
.\scripts\run-teams-local.ps1 -Status          # Check backend, client and connection separately
.\scripts\run-teams-local.ps1 -Resume          # Finish without restarting/losing pairing
.\scripts\run-teams-local.ps1 -Resume -Reinstall
.\scripts\run-teams-local.ps1 -Stop
```

After one-time setup, it discovers the private live configuration at
`%LOCALAPPDATA%\TLC-Assist\Teams\configuration\cli.env` and trusted PEM files at
`%LOCALAPPDATA%\TLC-Assist\Teams\certs\localhost.pem` / `localhost-key.pem`.
The origin comes from `-Origin`, configured `TLC_TEAMS_ORIGIN`, or defaults to
`https://localhost:3978`. It verifies HTTPS before sideloading and also supports
an existing approved HTTPS ingress. It never creates/trusts certificates or
signs in to MSX automatically. The guide asks for explicit **CONNECT** confirmation
and the exact code displayed by the Teams page, then requires a fresh matching
client/build/runtime acknowledgement before printing **VERIFIED**. Upload success
or a browser preview alone is not completion. `-BackendOnly` defers installation;
`-NoGuide` permits unattended upload without claiming rendering/pairing. See the
[guided instructions](docs/runbooks/teams-app.md#recommended-guided-windows-launch-installation-and-pairing).

The [Teams runbook](docs/runbooks/teams-app.md) distinguishes the installation ZIP,
the separately deployable runtime ZIP, and explicitly unconfigured development
packages. It covers start/stop, configuration, logs, state/backup/recovery, F5,
opt-in HTTPS exposure, manifest/Teams setup, local-to-Azure changes and unverified
live/ingress gates. ZIP generation or browser-only testing is not production readiness.

For a per-user live Portfolio using an existing local corporate sign-in, the
explicit [Azure CLI profile](docs/runbooks/teams-app.md#per-user-windows-msx-using-the-existing-cli-user)
verifies that user's Dataverse identity and automatically loads their deal-team
accounts. It is private, needs no new native/API/bot registration, and supports
Desktop-equivalent MSX writes through the shared review/approval and audit path.
Source permissions remain enforced; no FTE or publication role is inferred.
Use `-CliWriteMode read-only` to retain read-only access. The separate native and hosted profiles retain
their own approvals and capabilities.

Teams uses the same **New, Discover, Portfolio, Plays, Dashboards** navigation as
the VS Code extension, opening Portfolio by default. Its responsive account,
opportunity, and Next Best Actions workbench retains private reviewed changes.
Meetings, Activity and Context settings are under **Tools**. The sample Seller
Dashboard is available; live Teams cannot read the runtime operator's private
Windows seller profile. See the [Teams UI guide](docs/runbooks/teams-app.md#extension-aligned-workspace).

## Data modes

Every surface runs in one of two modes:

- **Sample mode** (default) — bundled sanitized data. No sign-in, no network; explore without touching MSX, Foundry, Azure, or Microsoft Entra ID.
- **Live mode** — real opportunity data over **MSX OData** and **Dataverse MCP**, plus Microsoft Foundry agents. Requires corporate identity and the surface's approved authentication. Teams uses its selected private CLI/native or hosted Entra/NAA/OBO profile, never the VS Code credential. Optional source/model capabilities depend on that profile's grants.

See [Documentation](#documentation) for the full user guide, FAQ, and runbooks.

### Account Discovery

Use **Add customer** to find an accessible existing MSX account by exact/partial name,
typo-aware suggestions, or exact TPID, then explicitly add or unhide the intended account
in your own Portfolio. The dialog shows its Sample/Live source; Sample never searches
real customers. TPID metadata and indexed-search capability are verified, and a TPID may
identify several accounts. Account addition does not join any team; use Discovery for
separate opportunity/milestone membership actions. See
[Account Discovery implementation and validation](docs/Account-Discovery-Portfolio-Feasibility.md).

### Opportunity and Milestone creation

In each surface, open **New** (immediately before **Discover**), choose **Opportunity**,
**Multiple Opportunities**, or **Milestone**, and select an Account. A Milestone for an existing
Opportunity uses an authorized parent from that Account; new Opportunities can include child
Milestones. Multiple Opportunities support repeated forms, an editable grid, and paired CSV import;
existing-parent Milestones support repeated forms, an editable grid, and Milestone CSV import.
The Teams development surface places the same creation/draft workflow under
**Accounts > New / draft** and uses its own sanitized sample database.
Import validates and loads an editable draft; **it does not insert records**. Whether using a form
or CSV, select **Validate & review**, check the Account, target, fields, and mutation count, then
select **Submit to SQLite** to insert the batch. **Export draft** only downloads files.
Child Milestones inherit the selected Opportunity's currency.

Creation writes are available **only in the sanitized SQLite sample store**: set
`TLC_DATA_MODE=sample` and `TLC_DATA_STORE=sqlite` for Desktop, or
`TLC_WEB_MODE=sample` and `TLC_DATA_STORE=sqlite` for the hosted Web app. For VS Code,
select sample mode and set `tlc.dataStore` to `sqlite`. Ordinary fixture-only sample mode and live
mode can export a draft instead; **live MSX Opportunity/Milestone creation is disabled**. The
standalone static Web preview needs a hosted API and cannot save or export drafts. Estimated close
date is required for SQLite creation. A batch is all-or-nothing and is limited to 50 mutations
(two per new Opportunity, including its creator Deal Team row, plus one per Milestone).
Selected SQLite sample mode is file-backed on Desktop (the app's local user-data directory)
and VS Code (extension storage), so submitted records survive restarts. Both Desktop demo
launchers use `%LOCALAPPDATA%\TLC MultiAgent Assist\desktop-demo-sample.sqlite`; the local
Web demo launcher uses a **separate** `web-demo-sample.sqlite` in that directory for Sample
Web at `http://127.0.0.1:8080`. The three stores do not synchronize records. For a
non-demo Web host, set `TLC_DATA_STORE_PATH` to a file to persist SQLite records; without
that path its SQLite sample store is in-memory. `TLC_DATA_STORE_PATH` also overrides the
Desktop/VS Code sample store path when set explicitly. Live Web on port 8081 only exports
drafts. Close previous Web demo consoles before relaunching; occupied ports are rejected.

See the [Opportunity and Milestone creation walkthrough](docs/user-guide/USER-GUIDE.md#new-opportunity-and-milestone-creation)
for per-surface setup, forms, CSV import, review/submission, storage locations, and missing
Submit-button troubleshooting. The [sanitized CSV/JSON examples](tests/fixtures/record-creation/README.md)
are ready to import.

## VS Code extension

Requires **VS Code or VS Code Insiders 1.90.0 or later**. The extension is self-contained (no Node.js, npm, or native binaries), embeds its own MCP registry and tool policy, and starts in sample mode.

### Install

1. Open the [VS Code extension releases](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=extension) and expand **Assets**. Stable builds and nightly **Pre-release** builds both appear here.
2. Download `tlc-assist-vscode-<version>.vsix`. The companion `tlc-assist-vscode-mcp-config-<version>.zip` is optional.
3. Install it from the Command Palette (`Ctrl+Shift+P`) with **Extensions: Install from VSIX...**, or run `code --install-extension tlc-assist-vscode-<version>.vsix --force`. Confirm the publisher-trust prompt on VS Code 1.97+.
4. Run **Developer: Reload Window**, then open **TLC Assist** from the Activity Bar (or run **TLC: Open Assist**).

`.vsix` installs are not auto-updated — re-install a newer `.vsix` to upgrade. Full walkthrough: [VS Code extension install guide](docs/user-guide/VSCODE-EXTENSION-INSTALL.md). To **build from source and install from the command line** instead, see the [command-line build, install, and run guide](docs/user-guide/VSCODE-EXTENSION-CLI.md).

### Modes and data store

Two independent toggles, set in **Settings** (search "tlc") or via the F5 launch configs:

- **`tlc.mode`** — `sample` or `live`.
- **`tlc.dataStore`** — `fixture` (in-memory) or `sqlite` (a persistent relational test store). Applies to sample mode only; ignored in live mode.

Switch at runtime from the Command Palette: **TLC: Use Live Data (MSX/Dataverse)** or **TLC: Use Sample Data**. The status bar flips between `TLC Assist: Live` and `Sample`. (**TLC: Test Live Connection** only tests connectivity; it does not switch.)

- **SQLite test store** — a file-backed relational database (accounts, opportunities, milestones, stakeholders, meetings/transcripts) whose submitted records survive VS Code restarts, ideal for exercising writes and meeting capture offline. Set `tlc.dataStore` = `sqlite`, or press **F5** and pick **Run TLC Assist Extension (SQLite test store)**. The default fixture data store remains in-memory and draft-only for creation.
- **Live mode** — sign into VS Code with your corporate Microsoft account. The extension uses that Microsoft authentication provider for both delegated MSX access and Foundry agents. Then run **TLC: Use Live Data (MSX/Dataverse)** or set `tlc.mode` = `live`. If a delegated token cannot be acquired, the extension shows an error and stays on sample — check **Output → TLC Assist**.
- **Foundry meeting extraction** — set `tlc.meetingExtractor` = `foundry` (optional `tlc.meetingModel`, default `gpt-6.1-sol`) to extract transcript signals with a deployed Foundry model instead of the offline rules. Uses VS Code's Microsoft sign-in; no API key is stored.

**Meeting capture (live mode):** on an opportunity's **Overview → Milestones** header, paste or upload a transcript. Signals for the milestones you select (commitment, risk) are written to the real milestone records; other signals and recommended next steps are captured into a dated note on the opportunity's comments. Writes are all-or-none (validate → apply → compensate). Microsoft Graph meeting acquisition is not wired yet.

**Run from source (F5):** [.vscode/launch.json](.vscode/launch.json) provides Extension Development Host configurations — fixtures, SQLite test store, SQLite + Foundry extraction, and Live MSX/Dataverse. Full command-line build, install, and run steps are in the [command-line guide](docs/user-guide/VSCODE-EXTENSION-CLI.md); packaging and release details are in the [VS Code extension runbook](docs/runbooks/vscode-extension.md).

## Desktop app

### Install

1. Open the [desktop releases](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=desktop), choose the latest desktop release, and expand **Assets**.
2. Download a Windows x64 file:
   - `TLC-MultiAgent-Assist-<version>-Windows-x64.exe` — recommended installer with Start menu and desktop shortcuts.
   - `TLC-MultiAgent-Assist-<version>-Windows-x64.zip` — portable build for users without installation access.
3. If the browser or Windows flags the download, choose to keep it, then right-click the file → **Properties** → **Unblock** → **Apply**. Continue only if the file came from this repository's GitHub Releases page.
4. Run the installer and choose **Only for me** or **Anyone who uses this computer**, then finish setup. For the portable ZIP, **Extract All** and run `TLC MultiAgent Assist.exe` from the extracted folder.

Detailed steps and troubleshooting: [desktop installation guide](docs/user-guide/DESKTOP-INSTALL.md).

### Run in sample mode

Close any running instance first. From **Command Prompt** (`cmd.exe`), launch the installed app with sample data:

```cmd
set "TLC_DATA_MODE=sample" && "%LOCALAPPDATA%\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

Or from **PowerShell**:

```powershell
$env:TLC_DATA_MODE = 'sample'
& "$env:LOCALAPPDATA\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

For other builds, replace the executable path: the portable ZIP runs `"TLC MultiAgent Assist.exe"` from its extracted folder, and a local build runs `".\release\win-unpacked\TLC MultiAgent Assist.exe"`. The quotes around `TLC_DATA_MODE=sample` are required — without them a trailing space becomes part of the value and the app starts in live mode. In sample mode the app loads bundled sanitized data and shows no login dialog.

### First run (live mode)

Start the app and sign in with your authorized corporate identity when prompted. Packaged releases include the default Foundry project and agent configuration, so no endpoint setup is required for normal use.

To use your own Foundry project, edit `%APPDATA%\@tlc\desktop\foundry.environment.json` and replace the `foundry.projectEndpoint` and `foundry.agents` values. This per-user file overrides the bundled defaults, is preserved during upgrades, and must never contain client secrets, access tokens, API keys, or credential-bearing connection strings.

## Web application

TLC Assist also runs as a browser-based app that serves the same UI, suited for hosting on Azure App Service.

Run locally with bundled sample data (no sign-in or network):

```powershell
npm install
npm run web:start
```

Run against live local data with an Azure CLI sign-in:

```powershell
az login
npm run web:start:live
```

Build an Azure App Service-ready package with `npm run web:release`, or push a `web-v*` tag to publish the ZIP to GitHub Releases. Full deployment details: [web setup and hosting runbook](docs/runbooks/web-app.md).

## Seller Dashboard

The separate **Seller Dashboard** pane is available on Desktop, Web, and the
VS Code webview. Its four sections cover Pipeline & Hygiene, ACR & Insights,
Consumption & Growth, and U2C Progress without changing existing panes.
Sample mode uses one fictitious offline snapshot; official attainment stays fixed
under working-view filters. Desktop and local Windows VS Code can read the seller's own validated,
Windows-user-encrypted MCAPS collector profile, with explicit refresh approval.
Missing consumption/history sources remain unavailable, never synthetic live data.
All Web modes, including local Azure CLI Web, deny host-user private profiles until
HTTP caller authentication is bound to the seller identity; Web sample mode remains available.
See [setup and methodology](docs/user-guide/SELLER-DASHBOARD.md) and the
[source analysis/implementation plan](docs/Seller-Dashboard-Implementation.md).

## Voice search

The main portfolio search supports a microphone button and **Ctrl+Alt+M** on all
three current surfaces. Speech is processed offline on the user's device, shown
as a preview, then inserted for review; Enter/result selection remains explicit.
Desktop and local Windows VS Code use installed English Windows speech
recognition; Web uses a bundled offline model. Remote VS Code voice is disabled
to prevent remote microphone capture. See [voice search setup and privacy](docs/user-guide/VOICE-SEARCH.md).

## Development

```powershell
npm install
```

### Run from source

| Target | Command | Notes |
| --- | --- | --- |
| Desktop (sample) | `npm run desktop:start` | First copy the Foundry config: `Copy-Item config/foundry.environment.example.json config/foundry.environment.json`. |
| Desktop (package) | `npm run desktop:package` | Windows artifacts are written to `release/`. |
| Web (sample) | `npm run web:start` | See [Web application](#web-application). |
| Web (live) | `az login` then `npm run web:start:live` | Uses the private Foundry environment file plus an Azure CLI sign-in. |
| VS Code extension | **F5** in VS Code | See the launch configs under [VS Code extension](#vs-code-extension), or the [command-line build/install/run guide](docs/user-guide/VSCODE-EXTENSION-CLI.md). |

Packaged desktop releases seed the non-secret shared Foundry configuration automatically and open the system browser for Microsoft sign-in. The private developer file above stays ignored and can override the shared default. Downloaded artifacts may need to be unblocked before launch (right-click → **Properties** → **Unblock**).

### Release workflows

Pushing a version tag runs the matching workflow and publishes to GitHub Releases. Each release stream is kept separate from the others.

| Tag | Workflow | Publishes | Local equivalent |
| --- | --- | --- | --- |
| `v0.1.0` | Desktop release | Installer + portable ZIP | `npm run desktop:package` |
| `web-v0.1.0` | Web release | Azure App Service ZIP (validated and smoke-tested) | `npm run web:release` |
| `ext-v0.1.0` | VS Code extension release | `.vsix` + optional MCP config bundle | `npm run ext:release` |

The `ext-v*` tag must match the extension `version` in `apps/vscode-extension/package.json`. Manually running the desktop workflow publishes a run-specific tag such as `v0.1.0-build.2` unless a tag is supplied.

## Documentation

- [Technology stack](TechStack.md)
- [End-user guide](docs/user-guide/USER-GUIDE.md)
- [Account Discovery: implementation and validation](docs/Account-Discovery-Portfolio-Feasibility.md)
- [Voice search: usage, offline engines, and tests](docs/user-guide/VOICE-SEARCH.md)
- [Frequently asked questions](docs/FAQ.md)
- [VS Code extension install (end user)](docs/user-guide/VSCODE-EXTENSION-INSTALL.md)
- [VS Code extension — command-line build, install, and run](docs/user-guide/VSCODE-EXTENSION-CLI.md)
- [Desktop setup and troubleshooting](docs/runbooks/desktop-app.md)
- [Web setup and hosting](docs/runbooks/web-app.md)
- [VS Code extension build, package, and deploy](docs/runbooks/vscode-extension.md)
