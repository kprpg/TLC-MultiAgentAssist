# Install the TLC Assist VS Code Extension

This guide explains how to download and install the **TLC Assist** VS Code extension from
the GitHub Releases page, and what is (and is not) required to run it. The extension brings
the TLC MultiAgent Assist account-team operations and opportunity-guidance experience into
VS Code.

> Prefer to **build from source and install from the command line**? See the
> [command-line build, install, and run guide](./VSCODE-EXTENSION-CLI.md).

## What you need

Installing the extension requires only **VS Code** or **VS Code Insiders**, version
**1.90.0 or later**, and the released `.vsix` file. The `.vsix` is self-contained: it
bundles all of its JavaScript dependencies and the MCP server registry and tool policy, and
it has no native binaries, so it works on Windows, macOS, and Linux without Node.js, npm, or
any extra install.

| To... | You need |
| --- | --- |
| Install the extension | VS Code / VS Code Insiders **1.90.0+** and the `.vsix`. Nothing else. |
| Run in **sample** mode (default) | Nothing more — no sign-in, no network, no Azure CLI. |
| Run in **live** mode | A corporate Microsoft identity (VS Code's built-in Microsoft sign-in) with MSX/Dataverse access, and network access to `microsoftsales.crm.dynamics.com`. |
| Use the real Microsoft Foundry agents (on by default in live mode) | **Azure CLI** installed and `az login` completed, plus access to the configured Foundry project. Turn off `tlc.useFoundryAgents` to use the built-in deterministic guidance instead. |
| Wire VS Code's own MCP client to Dataverse (optional) | The MCP config bundle described in [Optional: MCP configuration](#optional-mcp-configuration). |

> The separate **MCP configuration bundle** on the release page is optional. The extension
> already embeds the MCP server registry and the default-deny tool policy, so you do not
> need the bundle to install or run TLC Assist. It is provided for transparency and for
> optionally connecting VS Code's native MCP client (for example Copilot Chat agent mode)
> to the same Dataverse endpoint.

## 1. Download the extension

1. Open the [latest VS Code extension release](https://github.com/kprpg/TLC-MultiAgentAssist/releases?q=ext-v).
2. Expand **Assets** if the files are not already visible.
3. Download:
   - `tlc-assist-vscode-<version>.vsix` — the extension package (required).
   - `tlc-assist-vscode-mcp-config-<version>.zip` — the optional MCP configuration and
     reference bundle.

Only continue when the download source is this repository's GitHub Releases page and the
file names match the patterns above.

## 2. Install the `.vsix`

Use either the UI or the command line.

**From the VS Code UI**

1. Open the **Extensions** view (`Ctrl+Shift+X`).
2. Select the **...** (Views and More Actions) menu at the top of the view.
3. Select **Install from VSIX...** and choose the downloaded
   `tlc-assist-vscode-<version>.vsix`.

**From a terminal**

```powershell
code --install-extension tlc-assist-vscode-<version>.vsix --force
# or VS Code Insiders:
code-insiders --install-extension tlc-assist-vscode-<version>.vsix --force
```

VS Code 1.97 and later shows a one-time **publisher trust** dialog the first time you
install the extension. Confirm it to continue.

## 3. Reload and open

1. Run **Developer: Reload Window** from the Command Palette (`Ctrl+Shift+P`), or restart
   the editor.
2. Select the **TLC Assist** icon in the Activity Bar, or run **TLC: Open Assist** from the
   Command Palette.

The extension starts in **sample** mode (sanitized fixtures, no network calls).

## 4. (Optional) Switch to live mode

1. Run **TLC: Use Live Data (MSX/Dataverse)** from the Command Palette (`Ctrl+Shift+P`) —
   or open **Settings** (`Ctrl+,`), search `tlc.mode`, and set it to `live`. The status bar
   switches to `TLC Assist: Live`. (The **TLC: Test Live Connection** command only *tests*
   connectivity; it does not switch the data source.)
2. When prompted, sign in with your authorized corporate Microsoft account (VS Code's
   built-in Microsoft sign-in).
3. For the real Foundry agents, make sure the Azure CLI is installed and run `az login`
   first. If you do not want to use Foundry, turn off `tlc.useFoundryAgents` to use the
   built-in deterministic guidance.
4. Run **TLC: Use Sample Data** at any time to switch back. If the delegated token cannot be
   acquired, the extension shows an error and stays on sample — check **Output → TLC Assist**.

> **Sample data store:** in sample mode, `tlc.dataStore` selects `fixture` (in-memory) or
> `sqlite` (a relational SQLite test store whose injected values persist for the session).

See the extension [README](../../apps/vscode-extension/README.md) for the full list of
settings and behaviors.

## Optional: MCP configuration

The `tlc-assist-vscode-mcp-config-<version>.zip` bundle contains:

- `.vscode/mcp.json` and `.mcp.json` — ready-to-use configuration that points VS Code's
  native MCP client at the Dataverse MCP endpoint. Copy `.vscode/mcp.json` into your
  workspace's `.vscode` folder, or `.mcp.json` into the workspace root (the portable format
  also works with the Copilot CLI and Agent Host).
- `config/mcp.servers.json`, `config/mcp.tool-policy.json`,
  `config/dataverse.entity-map.json`, and `config/foundry.environment.example.json` — the
  reference configuration the extension was built with, for transparency and for seeding
  your own deployments.
- `INSTALL.md` — the same guidance, packaged alongside the files.

These are optional. Editing them does not change the installed extension.

## Updates

Extensions installed from a `.vsix` are **not auto-updated**. To upgrade, download the
newer `.vsix` from the Releases page, install it the same way, and run **Developer: Reload
Window**.

## Uninstall

- From the UI: **Extensions** view → select **TLC Assist** → **Uninstall**.
- From a terminal: `code --uninstall-extension tlc.tlc-assist-vscode`.

## Next steps

- Continue with the [end-user guide](USER-GUIDE.md).
- Builders and maintainers: see the
  [VS Code extension build, package, and release runbook](../runbooks/vscode-extension.md).
