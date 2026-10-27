# TLC Assist for VS Code

TLC Assist brings the TLC MultiAgent Assist account-team operations and opportunity
guidance experience into VS Code as a third trusted host over the shared product core.

It defaults to **SQLite sample business data with real Foundry AI**. Only inference
uses the network; missing Foundry access produces a labeled offline fallback. Select
`tlc.aiMode=sample` (or `TLC_AI_MODE=sample`) for completely offline AI. Live mode
continues to use its existing delegated Dataverse/MSX access and keeps tokens in the
extension host. See [sample Foundry setup](../../docs/runbooks/sample-foundry-ai.md).

## Features (sample mode)

- **Activity Bar** container with Connection, Portfolio, and Plays views.
- **Workbench** webview (editor area) for portfolio work, MCEM stage review, four agent
  capabilities, and deterministic plays.
- **Account curation**: add a customer by name or TPID, remove a tracked customer with
  named confirmation beside Add customer or from the selected account, and restore it
  through Add customer > Add again. Empty manually added accounts remain available for Discovery.
- **Discovery**: review all active opportunities for visible accounts by Solution
  Engineer domain and use **Add me** or **Remove me** for the real Deal Team membership.
  Azure-portal-style customer filter chips support inclusion and exclusion with
  searchable multi-select choices. Select **Account**, **Stage**, or **Action** to
  toggle ascending/descending sorting, just as in the desktop and web apps. These
  filters affect only the Discovery view, not account visibility or membership.
- **Action styling**: Add/Remove customer, Comments, sorting, and filter controls
  use the theme's accent/link color; customer and opportunity names remain data text.
  Removal actions retain their warning color and disabled controls remain muted.
  The native **TLC: Refresh Data**, **TLC: Add Customer Account**, and **TLC: Remove
  Customer Account** toolbar commands, plus the inline **Remove Customer Account** action,
  use blue light/dark SVG icons. This workspace gives native hover widgets a
  high-contrast blue-on-dark palette, and TLC webview popups reuse that palette with
  semibold text. VS Code continues to own the native tooltip font.
- **Plays**: run named workflows (stale opportunity sweep, overdue milestone triage,
  governance exceptions, and more) and review typed result cards and operational queues.
  Live results appear page by page and remain marked incomplete until the run finishes.
  The initial cohort allows 60 seconds for execution and 15 seconds of UI completion
  grace; capped or unavailable sources remain visibly partial. See the
  [Play performance and regression guide](../../docs/performance/performance-optimization.md#plays-deadlines-query-cost-and-first-page-results).

Visible active opportunities where the signed-in user is a current Deal Team member
or belongs to a milestone team enter Portfolio, milestones, agents, and Plays.
Discovery's **On deal team** label uses only actual Deal Team membership; a milestone-only
opportunity offers **Add me** even though it remains in Portfolio. Adding an account
alone never expands that downstream working set. Remove customer is a reversible
TLC-only preference: it clears the account from active Portfolio, Discovery, search,
New selectors, and future Plays, without deleting source records or changing Deal
Team or milestone-team membership. Saved runs and the official Seller Dashboard are
unchanged. Preferences stay local to the current app/profile rather than syncing
between Desktop, Web, and VS Code. Native tree and workbench views refresh together.

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

For a quieter Debug Console, select **Run TLC Assist Extension (isolated)** in Run and
Debug before pressing `F5`. It disables other installed extensions only in that debug
window; TLC and built-in Microsoft authentication remain available. It uses the same
TLC settings and storage as the standard profile and does not affect your normal editor.
The existing profiles still load installed extensions for integration testing. Remaining
Node warnings are not suppressed.

After changing extension-host or connector code, stop the running debug session
(`Shift+F5`) and launch it again (`F5`). The pre-launch task rebuilds the host and webview;
rebuilding files or refreshing Discovery alone does not replace code already loaded in
an existing Extension Development Host.

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

## Install into your editor

To use the latest bits in your everyday VS Code / VS Code Insiders (instead of the F5
Extension Development Host), build + package + install in one step from the repository
root:

```powershell
npm run ext:reinstall:insiders   # VS Code Insiders
npm run ext:reinstall            # stable VS Code (falls back to Insiders)
```

Then run **Developer: Reload Window**. The installed `.vsix` and the F5 dev host are
independent — code edits only update the installed copy after you re-run one of these
scripts. Full details, the manual steps, and troubleshooting are in the
[VS Code extension runbook](../../docs/runbooks/vscode-extension.md).

## Security

- Delegated-user access only; tokens never enter the webview.
- Default-deny MCP tool policy; read-only first.
- Strict webview Content Security Policy with a per-load nonce.
- Every bridge message is schema-validated on the host.

See the phased plan in [docs/VSCodeExtension-Implementation-Plan.md](../../docs/VSCodeExtension-Implementation-Plan.md).
