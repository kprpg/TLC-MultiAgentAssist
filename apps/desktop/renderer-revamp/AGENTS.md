# AGENTS.md — Shared Desktop + Web renderer (UI layer)

This React (Fluent UI) renderer is **shared by BOTH the Electron desktop app and the web app**. Any
change here ships to both surfaces — verify both. Inherits the root AGENTS.md.

## Data access (keep all transports in sync)
- UI talks to `src/data-client.ts`, which has **three transports**: web (HTTP `/api/*`), the Electron
  preload bridge, and an in-memory **sample** client. When you add or change a client method, update
  **all three** transports and the shared interface so Desktop, Web, and sample stay consistent.
- Requests/responses are parsed with the `packages/common` zod schemas — don't trust raw payloads.

## Parity
- Mirror user-facing changes with the **VS Code webview** (`apps/vscode-extension/src/webview`) so the
  three surfaces behave the same.
- Web auth is Azure Easy Auth (see `apps/web`); never read a local Azure CLI token from the web path.

## Build
- `npm run desktop:build` (Electron) and `npm run web:build` (web) both consume this renderer;
  `npm run desktop:dev` runs it against a Vite dev server.
