# TLC Assist for VS Code

TLC Assist brings the TLC MultiAgent Assist account-team operations and opportunity
guidance experience into VS Code as a third trusted host over the shared product core.

This is an early, read-only build. It defaults to **sample mode** with sanitized fixtures
and makes no network calls. Live delegated Dataverse/MSX access is gated and not yet
enabled.

## Features (sample mode)

- **Activity Bar** container with Connection, Portfolio, and Plays views.
- **Workbench** webview (editor area) for portfolio work, MCEM stage review, four agent
  capabilities, and deterministic plays.
- **Plays**: run named workflows (stale opportunity sweep, overdue milestone triage,
  governance exceptions, and more) and review typed result cards and operational queues.

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
