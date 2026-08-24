# Run the Desktop App

## Prerequisites

- Windows 10 or later
- Node.js 22.12 or later
- npm 10 or later

Check the installed versions:

```powershell
node --version
npm --version
```

## First-time setup

From the repository root:

```powershell
npm install
```

## Launch the app

Sign in to Azure CLI with your own Microsoft corporate identity. Do not put a fixed user ID in application configuration:

```powershell
az login
```

The app validates that the returned MSX token belongs to an `@microsoft.com` CORP ID and displays the discovered identity in the toolbar.

Build all Electron bundles and open the desktop app:

```powershell
npm run desktop:start
```

This command builds the Electron main process, preload script, and React renderer before launching the application.
By default, accounts and opportunities come from live MSX and are scoped to active opportunities where that corporate user is on the deal team. Access tokens remain in the trusted Electron main process.

To launch with sanitized fixtures instead:

```powershell
$env:TLC_DATA_MODE = 'sample'
npm run desktop:start
```

## Development mode

Start Vite in watch mode and launch Electron with live renderer updates:

```powershell
npm run desktop:dev
```

Stop development mode with `Ctrl+C` in the terminal that started it.

## Build without launching

```powershell
npm run desktop:build
```

Generated files are written under:

- `apps/desktop/dist-electron`
- `apps/desktop/dist/renderer`

## Validate the desktop experience

Run the Electron smoke test:

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/desktop/preview.spec.ts
```

The direct Node invocation avoids Windows command-shim issues that can affect `npx playwright`.

## Theme selection

Use the sun or moon button in the top-right toolbar to switch between light and dark mode. The selected theme is saved locally and restored on the next launch.

## Troubleshooting

### Electron does not open

Rebuild the generated bundles and try again:

```powershell
npm run desktop:build
npm run desktop:start
```

### Dependencies are missing or stale

```powershell
npm install
npm run desktop:start
```

### Port 5173 is already in use

Development mode uses port 5173. Stop the process using that port, or use the production-style command instead:

```powershell
npm run desktop:start
```

### Full typecheck reports errors

The desktop build can be checked independently with:

```powershell
npm run desktop:build
```

A workspace-wide typecheck uses:

```powershell
npm run typecheck
```
