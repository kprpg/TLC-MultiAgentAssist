# TLC Assist for VS Code

TLC Assist brings the TLC MultiAgent Assist account-team operations and opportunity
guidance experience into VS Code as a third trusted host over the shared product core.

It defaults to **sample mode** with sanitized fixtures and makes no network calls. Live
mode uses delegated Dataverse/MSX access while keeping access tokens in the extension
host.

## Features (sample mode)

- **Activity Bar** container with Connection, Portfolio, and Plays views.
- **Workbench** webview (editor area) for portfolio work, MCEM stage review, four agent
  capabilities, and deterministic plays.
- **Account curation**: add a customer by name or TPID, show or hide customer nodes, and
  keep empty manually added accounts available for Discovery.
- **Discovery**: review all active opportunities for visible accounts by Solution
  Engineer domain and use **Add me** or **Remove me** for the real Deal Team membership.
  Azure-portal-style customer filter chips support inclusion and exclusion with
  searchable multi-select choices. Select **Account**, **Stage**, or **Action** to
  toggle ascending/descending sorting, just as in the desktop and web apps. These
  filters affect only the Discovery view, not account visibility or membership.
- **Action styling**: Hide/Unhide, Show hidden, Comments, sorting, and filter controls
  use the theme's accent/link color; customer and opportunity names remain data text.
  Removal actions retain their warning color and disabled controls remain muted.
  The native **TLC: Refresh Data**, **TLC: Add Customer Account**, and **TLC: Toggle
  Hidden Customers** toolbar commands, plus inline **Hide/Unhide Customer** actions,
  use blue light/dark SVG icons. This workspace gives native hover widgets a
  high-contrast blue-on-dark palette, and TLC webview popups reuse that palette with
  semibold text. VS Code continues to own the native tooltip font.
- **Plays**: run named workflows (stale opportunity sweep, overdue milestone triage,
  governance exceptions, and more) and review typed result cards and operational queues.

Only visible opportunities where the signed-in user is a current Deal Team member enter
Portfolio, milestones, agents, and Plays. Adding an account alone never expands that
downstream working set. Hide/Unhide is a TLC-only preference and does not change MSX Deal
Team membership.

In live mode, configure `TLC_MSX_ACCOUNT_TPID_FIELD` with the tenant-verified logical
field name to enable TPID search. Name search remains available without it. Account
preferences are partitioned by Dataverse user ID and stored under the extension global
storage directory; no credential is stored in the preference file.

## Develop

From the repository root:

```powershell
npm install
npm run --workspace apps/vscode-extension build
```

Then open the repository in VS Code and press `F5` to launch the Extension Development
Host. Run **TLC: Open Assist** or select TLC in the Activity Bar.

Watch mode during development:

```powershell
npm run --workspace apps/vscode-extension watch:host
npm run --workspace apps/vscode-extension watch:webview
```

## Test

```powershell
npm run --workspace apps/vscode-extension typecheck
npm test -- tests/unit/vscode-extension tests/contract/vscode-extension-bridge.contract.test.ts
npm run --workspace apps/vscode-extension test:extension
```

Cross-host Discovery filtering and sorting are also covered by the shared UI smoke
suite, which builds the desktop/web renderer and the VS Code webview before testing:

```powershell
npm run test:smoke:revamp -- --grep "filters and sorts Discovery"
```

## Package

```powershell
npm run --workspace apps/vscode-extension build
npm run --workspace apps/vscode-extension package
```

## Security

- Delegated-user access only; tokens never enter the webview.
- Default-deny MCP tool policy; read-only first.
- Strict webview Content Security Policy with a per-load nonce.
- Every bridge message is schema-validated on the host.

See the phased plan in [docs/VSCodeExtension-Implementation-Plan.md](../../docs/VSCodeExtension-Implementation-Plan.md).
