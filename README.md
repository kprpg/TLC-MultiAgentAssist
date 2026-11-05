![TLC MultiAgent Assist. Every opportunity, with its next move. Live MSX opportunity context and contextual guidance, shown with a sample workbench and luminous purple and pink gradients.](docs/media/landing-hero.png)

<p>
  <a href="#quick-install"><img src="docs/media/landing-install.png" height="52" alt="Choose your surface: install VS Code, Desktop or Web"></a>
  &nbsp;
  <a href="README-ORIGINAL.md"><img src="docs/media/landing-original.png" height="52" alt="Read the original README"></a>
</p>

[Original README & full text guide](README-ORIGINAL.md) · [Surfaces](#surfaces) · [Sample & Live](#data-modes) · [Workbench](#workbench) · [Dashboards](#dashboards) · [Guardrails](#guardrails) · [Documentation](#documentation)

## Quick install

| Surface & requirements | Install and open | Full instructions |
| --- | --- | --- |
| <a id="vs-code-extension"></a>**VS Code extension**<br>VS Code or Insiders **1.90.0+**. No separate Node.js/npm install. | Download `tlc-assist-vscode-<version>.vsix` from [extension releases](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=extension). Run **Extensions: Install from VSIX...**, then **Developer: Reload Window**. Open **TLC Assist** or run **TLC: Open Assist**. | [Install guide](docs/user-guide/VSCODE-EXTENSION-INSTALL.md) |
| <a id="desktop-app"></a>**Windows desktop**<br>Windows **x64**. Installer or portable ZIP. | From [desktop releases](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=desktop), download `TLC-MultiAgent-Assist-<version>-Windows-x64.exe` and run setup. Alternatively, extract the portable `.zip` and run `TLC MultiAgent Assist.exe`. | [Install guide](docs/user-guide/DESKTOP-INSTALL.md) |
| <a id="web-application"></a>**Web application**<br>Local setup: **Node.js 22.12+**, **npm 10+**, port **8080** available. | Clone [this repository](https://github.com/kprpg/TLC-MultiAgentAssist). From its root, run `npm ci`, then `npm run web:start`. Open [localhost:8080](http://127.0.0.1:8080). This starts sample business data; see the notes below for offline AI. | [Web setup & hosting](docs/runbooks/web-app.md) |

<a id="microsoft-teams-under-development"></a>
**Microsoft Teams is under development**, not a production-ready fourth release. [Teams development guide](docs/runbooks/teams-app.md).

<details>
<summary><strong>Installation notes, upgrades and completely offline sample mode</strong></summary>

- **VS Code upgrades:** `.vsix` installs are not auto-updated. Reinstall a newer `tlc-assist-vscode-<version>.vsix`, then reload the window. [Update instructions](docs/user-guide/VSCODE-EXTENSION-INSTALL.md#updates).
- **Windows downloads:** verify this repository's GitHub Releases as the source before using **Properties > Unblock**, if needed.
- **Sample data and AI are independent.** Foundry AI uses network/sign-in by default, with a labeled offline fallback. For fully offline sample AI, use `tlc.aiMode=sample` in VS Code, or `$env:TLC_AI_MODE = 'sample'` before launching Desktop/Web. [Sample and AI options](docs/runbooks/sample-foundry-ai.md).
- **Desktop normally starts live**, with corporate sign-in. For offline sample data and AI, close any running instance and launch from PowerShell:

```powershell
$env:TLC_DATA_MODE = 'sample'
$env:TLC_AI_MODE = 'sample'
& "$env:LOCALAPPDATA\Programs\TLC MultiAgent Assist\TLC MultiAgent Assist.exe"
```

For a portable or all-users installation, replace the executable path. Live access requires corporate identity and approved source permissions.

</details>

<p>
  <a id="surfaces"></a>
  <img src="docs/media/landing-surfaces.png" width="1280" alt="One codebase, wherever you work. Connected cards introduce VS Code, Windows desktop, Web and the Teams development surface, all using one TLC core.">
  <a id="data-modes"></a>
  <img src="docs/media/landing-modes.png" width="1280" alt="Sample and Live, by choice. Sanitized business data is isolated from live MSX and Dataverse sources. AI is configured separately. Corporate sign-in and approved permissions gate live access to one shared core.">
  <a id="workbench"></a>
  <img src="docs/media/landing-workbench.png" width="1280" alt="Follow one opportunity from evidence to action. MSX compares the record with evidence; Multi-Agent Guidance provides an owner-based plan; MCEM Stage Management shows the stage board. The sample workbench also supports account discovery, drafts, meeting capture and offline voice search.">
  <a id="dashboards"></a>
  <img src="docs/media/landing-dashboards.png" width="1280" alt="Dashboards that keep unknowns visible: Seller Dashboard, Momentum and Focus, and SE Reporting Dashboard. Missing live sources stay unavailable, never synthetic.">
  <a id="guardrails"></a>
  <img src="docs/media/landing-guardrails.png" width="1280" alt="Writes go through review. Live creation stays off. Meeting capture validates, applies and compensates on failure. New-record batches are all-or-nothing, up to 50 mutations, in sanitized SQLite sample stores only. Private profiles and delegated permissions remain protected.">
</p>

<a id="documentation"></a>
<details>
<summary><strong>Text guides, feature details and development</strong></summary>

- [Original README - complete, searchable reference](README-ORIGINAL.md)
- [End-user guide and workbench tour](docs/user-guide/USER-GUIDE.md)
- [Seller Dashboard](docs/user-guide/SELLER-DASHBOARD.md)
- [Momentum & Focus](docs/architecture/Momentum-Focus-Dashboard-Proposal.md)
- [SE Reporting Dashboard](docs/user-guide/SE-REPORTING-DASHBOARD.md)
- [Opportunity and Milestone creation](docs/user-guide/USER-GUIDE.md#new-opportunity-and-milestone-creation)
- [Sanitized CSV/JSON creation examples](tests/fixtures/record-creation/README.md)
- [Account discovery](README-ORIGINAL.md#account-discovery)
- [Voice search and privacy](docs/user-guide/VOICE-SEARCH.md)
- [Knowledge search setup and provider contract](docs/Knowledge-Search-Connectors.md)
- [Frequently asked questions](docs/FAQ.md)
- [Technology stack](TechStack.md)
- <a id="development"></a>[Build and run from source](README-ORIGINAL.md#development)
- [Release workflows](README-ORIGINAL.md#release-workflows)
- [Product backlog](docs/Product-Backlog.md)

</details>

<details>
<summary><strong>Build and release status</strong></summary>

[![Continuous integration](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/ci.yml)
[![Nightly desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly.yml)
[![Desktop release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/desktop-release.yml)
[![Web release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/web-release.yml)
[![VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/vscode-extension-release.yml)
[![Nightly VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly-vscode-extension.yml/badge.svg)](https://github.com/kprpg/TLC-MultiAgentAssist/actions/workflows/nightly-vscode-extension.yml)

</details>

<p align="center">
  <a href="#quick-install">Choose your surface</a> &bull;
  <a href="README-ORIGINAL.md">Read the original README</a><br>
  <sub>Visual sections are static renders of the landing-page design. Use the original README for searchable, copyable details.</sub>
</p>
