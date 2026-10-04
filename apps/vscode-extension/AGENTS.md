# AGENTS.md — VS Code extension (UI layer)

Two halves: the **extension host** (`src/*` — `extension.ts`, `webview-controller.ts`,
`data-provider.ts`, `live-provider*.ts`, `message-contracts.ts`) and the **React webview**
(`src/webview/*`, entry `app.tsx`). Inherits the root AGENTS.md.

## Host ↔ webview bridge (typed, validated)
- All webview↔host calls go through a **typed postMessage bridge**. To add a capability, update **all**:
  1. `src/message-contracts.ts` — add the method to `BridgeMethod` + a zod param schema in `bridgeParamSchemas`.
  2. `src/webview/data-client.ts` — add the client wrapper (`request<...>('method', params)`).
  3. the host handler (`webview-controller.ts` / `data-provider.ts`) — implement it for **both** sample and live.
- Validate every inbound param with zod (`parseBridgeParams`). Responses are `{ kind:'response', id, ok, result }`.

## Webview constraints
- **Browser-only** — no Node imports in `src/webview` (eslint applies browser globals there). The bundle
  must stay Node-free.
- View types are **local structural mirrors** in `src/webview/view-types.ts`, not imported from
  `packages/common`, so the browser bundle has no Node deps. The host remains the schema authority.
- Use VS Code theme CSS variables (`--vscode-*`); keep parity with the Desktop/Web renderer for shared features.

## Build & modes
- Build: `npm run ext:build` (host via `vite.host.config.ts`, webview via `vite.webview.config.ts`).
- Sample vs live is chosen in the host (`createSampleDataProvider` / live provider); keep both paths working.
