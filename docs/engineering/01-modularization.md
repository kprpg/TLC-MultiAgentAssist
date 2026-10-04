# 01 — Code Evaluation & Modularization

> Capture only. Part of [Code / Refactoring / Optimization / Tests](Code-Refactoring-Optimization-Tests.md).
> Goal: keep a **stable backend**, a **stable orchestrator / middle-level harness**, and confine change
> to the **four UI layers** (Desktop, VS Code extension, Web, Teams-stub).

## 1. What is already healthy (protect it)

The research confirms the layered intent from [`docs/Folder-structure.md`](../Folder-structure.md) is
real and mostly intact. These are the load-bearing boundaries to defend, not rewrite:

- **Backend contracts are centralized and versioned.** `packages/common` exposes Zod-validated
  contracts with explicit version literals: `contractVersion` (`packages/common/contracts/index.ts`)
  and `workflowContractVersion` (`packages/common/contracts/workflows.ts`). Hosts and the
  orchestrator re-parse these at the boundary.
- **Connectors isolate source specifics.** `packages/connectors/common/index.ts` defines the
  `MsxConnector` / `McemGuidanceConnector` interfaces; implementations (`msx/live.ts`,
  `sharepoint/local-pdf.ts`, `foundry/index.ts`, the MCP adapters) hide OData, PDF parsing, retries,
  and token handling behind those interfaces.
- **The orchestrator is a single thin slice.** `ThinSliceOrchestrator`
  (`packages/orchestrator/index.ts`, ~14 operations) and `SharedWorkflowHost`
  (`packages/orchestrator/workflows/host.ts`) are shared by all three live hosts. Inputs are
  validated with Zod on the way in and schema-parsed on the way out.
- **Agent business logic is minimal and local only where it must be.** Only `mcem-coach` has local
  TypeScript logic (`packages/agents/mcem-coach/src/index.ts`, `evaluateMcemProgress`, ~111 lines);
  `account-pulse`, `pursuit-executive`, and `risk-solution-play` are Foundry-prompt agents with
  prompts/policies/manifests and **no `src/`** code (only `.gitkeep`).

**Rule:** changes to these layers go *behind the existing contracts*. Protecting this core is the
entire point of the UI-isolation and composition-root work below.

## 2. Where modularization has eroded (fix it)

Three concrete erosion points drive the backlog:

1. **Host wiring is copy-pasted across the three hosts** (composition duplicated, not the orchestrator).
2. **The transport/dispatch surface is re-listed per host** (~20 IPC handlers vs ~22 HTTP routes vs 23
   bridge cases) with per-handler validation.
3. **UI logic and view types are duplicated** between Desktop and VS Code because the webview cannot
   import Node-backed `packages/common` modules, so it re-declares its own copies.

Each is captured as an implementable item below.

---

## MOD-1 — Extract a shared host composition root · P0

**Problem / evidence.** The same connector/agent/workflow-host assembly is hand-written three times:

- Desktop: `apps/desktop/electron/main/index.ts:100-175` builds `LiveMsxConnector`,
  `LocalPdfMcemGuidanceConnector`, `createFoundryOpenAIClient`, the four-capability
  `FoundryPromptAgent` registry (`index.ts:107-132`), the `ThinSliceOrchestrator` (`:133-138`), and
  `createLivePlayWorkflowHost` (`:145-167`).
- Web: `apps/web/src/runtime.ts:18-60` repeats the Foundry client + four-agent registry + MSX
  connector, and `:62-107` repeats the live-play host assembly.
- VS Code: `apps/vscode-extension/src/live-provider.ts` + `live-provider-core.ts` repeat the same
  shape with deterministic/stub agents.

The four-capability tuple `['account-pulse','mcem-coach','pursuit-executive','risk-solution-play']`
is written out independently in at least Desktop and Web. Adding or renaming an agent means editing
every host.

**Proposed change.** Add shared factory functions (composition root) that each host calls:

- A Foundry **task-agent registry factory** (given a `FoundryEnvironment` + credential + shared
  client) that returns the `TaskAgentRegistry`.
- A **live MSX connector factory** and **MCEM guidance connector factory** with per-host path/token
  inputs.
- A **live-play environment loader** that reads `mcp.servers.json`, `mcp.tool-policy.json`, and
  `dataverse.entity-map.json` from a supplied config root.
- A single `createThinSliceOrchestrator(...)` convenience that each host wires with its own
  credentials/paths.

Hosts keep only what is genuinely host-specific: trust boundary, credential source
(`AzureCliCredential` vs `ManagedIdentityCredential` vs delegated token), config root resolution, and
lifecycle. Place factories next to their owners (`packages/connectors/*`, `packages/orchestrator/*`)
so dependency direction stays downward.

**Acceptance criteria.**
- Desktop, Web, and VS Code construct identical agent/connector graphs via shared factories; the
  four-capability list exists in exactly one place.
- No behavior change in sample or live mode; `npm run validate:major` stays green.
- Each host file shrinks to host-specific concerns only.

**Blast radius.** Medium. Touches all three host entry points but not the orchestrator contract or UI.

---

## MOD-2 — Single operation registry driving all three transports · P0

**Problem / evidence.** Every orchestrator/workflow operation is manually re-declared per transport:

- Desktop IPC: ~20 `ipcMain.handle('tlc:...')` blocks, each repeating `assertTrustedSender(event)` +
  a Zod `parse` (`apps/desktop/electron/main/index.ts:202-313`).
- Web HTTP: ~22 route branches with method+path matching and per-route schema parsing
  (`apps/web/src/app.ts:84-261`).
- VS Code bridge: 23 `switch` cases mapping method → provider call
  (`apps/vscode-extension/src/host-router.ts:29-136`), with params validated in
  `message-contracts.ts`.

The operation set is identical; only the envelope differs. Parity is partially guarded by
`tests/unit/hosts/workflow-transport-parity.test.ts` (workflow ops only), so the non-workflow
operations can silently drift between Desktop and Web.

**Proposed change.** Describe each operation once in a declarative registry (name, input schema,
output schema, orchestrator/host method). Generate the three transports from it:

- Desktop registers IPC handlers by iterating the registry (keeping `assertTrustedSender`).
- Web maps HTTP routes from the registry (keeping Easy-Auth + same-origin checks and REST path
  shapes).
- VS Code builds the bridge dispatch from the same registry (keeping host-only exclusions:
  `openEvidence`, `exportContent`, `composeEmail`).

**Acceptance criteria.**
- Adding an operation requires editing one registry entry; all three transports pick it up.
- Transport-parity tests cover the full operation set, not just workflows.
- Per-handler boilerplate (`assertTrustedSender` + `parse`) is defined once.

**Blast radius.** Medium-high. Central to every host; land behind expanded parity tests (see TEST-3).

---

## MOD-3 — `packages/ui-contracts` for browser-safe view types · P1

**Problem / evidence.** The VS Code webview cannot import `packages/common` (it pulls in Node-backed
modules), so it maintains a parallel type universe: `apps/vscode-extension/src/webview/view-types.ts`
(146 lines) re-declares `AccountView`, `OpportunityView`, `MilestoneView`, `McemView`,
`WorkflowDefinitionView`, etc. The desktop renderer instead imports browser-safe contracts directly
(per repository memory, the revamp renderer imports `view-contracts` and specific schemas, not the
broad barrels). The result is two diverging definitions of the same view shapes.

**Proposed change.** Introduce a dependency-free, browser-safe `packages/ui-contracts` (pure types +
Zod view schemas, no Node imports) that both the desktop renderer and the VS Code webview consume.
Re-export the existing `packages/orchestrator/workflows/view-contracts.ts` view schemas from here (or
move them) so there is one source of truth for view shapes.

**Acceptance criteria.**
- `apps/vscode-extension/src/webview/view-types.ts` is replaced by imports from `packages/ui-contracts`.
- Desktop renderer and webview reference the same view types; webview bundle still builds browser-only.
- No Node-only module is reachable from `packages/ui-contracts`.

**Blast radius.** Low-medium. Type-level change; verify the webview Vite bundle stays browser-safe.

---

## MOD-4 — `packages/ui-logic` for shared presentation helpers · P1

**Problem / evidence.** Near-identical presentation helpers are duplicated between surfaces:

- `response-markdown.ts` — `apps/desktop/renderer-revamp/src/response-markdown.ts` (23 lines) vs
  `apps/vscode-extension/src/webview/response-markdown.ts` (27 lines); functionally the same renderer
  with minor differences.
- `prompt-catalog.ts` — desktop vs webview copies are identical except the `AgentCapability` import
  source (`packages/common` vs local `view-types`).
- Sort helpers — desktop `opportunity-sort.ts` (22) + `milestone-sort.ts` (53) vs the webview's merged
  `sorting.ts` (63).
- Sample data — `apps/vscode-extension/src/sample-data.ts` (375) and the desktop
  `renderer-revamp/src/data-client.ts` (512, with embedded fixtures) carry overlapping sample
  opportunities/accounts (e.g. the same "Teams Phone" discovery record).

**Proposed change.** Create `packages/ui-logic` (browser-safe, depends only on `packages/ui-contracts`)
for markdown rendering, the prompt catalog, opportunity/milestone/discovery sorting, and a single
shared sample-data fixture set. Both UI layers import these instead of maintaining copies. Keep the
shared discovery controls in `apps/shared/` consistent with this (or fold them in).

**Acceptance criteria.**
- The duplicated helper files above are removed from the apps and imported from `packages/ui-logic`.
- One sample-data fixture feeds both desktop sample mode and the VS Code sample provider.
- Behavior (markdown output, sort order) is unchanged, protected by existing unit tests
  (`tests/unit/desktop/*`, `tests/unit/vscode-extension/*`).

**Blast radius.** Low-medium. Shared logic extraction; existing per-surface unit tests pin behavior.

---

## MOD-5 — Remove web→desktop/electron import coupling · P1

**Problem / evidence.** The web backend imports document/email helpers straight out of the Electron
app: `apps/web/src/app.ts:46-47` imports `createOutlookDraftMessage` and `createResponseDocumentBuffer`
from `../../desktop/electron/main/outlook-compose.js` and `.../response-document.js`. This couples the
web surface to the desktop host and crosses the UI-isolation boundary (one UI layer depending on
another's internals).

**Proposed change.** Move the transport-neutral document/email builders (`.docx` buffer, `.eml`
draft) into a shared package (e.g. `packages/common/documents` or a small `packages/documents`), and
have both the Electron main process and the web handler import from there. The Electron-only pieces
(save dialog, `shell.openPath`) stay in the desktop host.

**Acceptance criteria.**
- `apps/web` no longer imports from `apps/desktop`.
- Electron and web both build the same documents via the shared module; `tests/electron/*` and
  `tests/unit/web/*` stay green.

**Blast radius.** Low. Mechanical move + import updates; covered by existing document tests.

---

## MOD-6 — Enforced Teams stub surface boundary · P2

**Problem / evidence.** There is no Teams surface. A repo-wide search finds only sample data
("Teams Phone and calling rollout", `apps/desktop/renderer-revamp/src/data-client.ts`;
`apps/vscode-extension/src/sample-data.ts`) and "deal team" domain terms. `apps/` contains only
`desktop`, `shared`, `vscode-extension`, `web`. The existing structure gate
(`scripts/check-structure.mjs`) does not mention Teams, and `docs/TODO.md` references Teams only as a
future *notification channel*.

**Proposed change (stub only, no feature).** Establish the boundary now so future Teams work reuses
the stable core instead of forking it:

- Add an `apps/teams/` placeholder with a README stating scope (tab/bot/message-extension TBD), a
  manifest placeholder, and an entry point that depends only on the shared composition root
  (MOD-1) + operation registry (MOD-2) + `packages/ui-contracts`/`ui-logic`.
- Do not implement Teams SDK integration, authentication, or UI; keep it a documented stub.
- Capture the decision as a short ADR under `docs/decisions/` when the stub lands.

**Acceptance criteria.**
- A Teams placeholder exists with no business logic and no new runtime dependencies.
- The stub consumes shared contracts/logic only; no Teams-specific branching leaks into
  `packages/*` or the other UI layers.

**Blast radius.** Low. Additive scaffolding; explicitly out of scope to build the real surface.

---

## MOD-7 — Enforce dependency direction (ESLint) + extend the structure gate · P1

**Problem / evidence.** The dependency rules in [`docs/Folder-structure.md`](../Folder-structure.md)
(§"Dependency Direction") are documented but not enforced. `eslint.config.js` has no
import-boundary rules, so nothing prevents a UI module importing a connector, `packages/common`
importing upward, or one UI layer importing another (see MOD-5). The structure gate
(`scripts/check-structure.mjs`) only checks that directories exist.

**Proposed change.** Encode the layering as lint rules (e.g. `no-restricted-imports` zones or an
import-boundaries rule set) matching the documented direction:

- UI → may import `ui-contracts`/`ui-logic` and host bridge; may **not** import `packages/connectors`
  or another app.
- `packages/common` → may not import orchestrator/agents/connectors/apps.
- `packages/agents` → may not import another agent or any app.
- `packages/connectors` → may not import agents or apps.

Extend `check-structure.mjs` to assert the new shared packages and the Teams stub exist.

**Acceptance criteria.**
- A violating import fails `npm run lint`.
- `npm run check:structure` validates the added package/stub directories.
- The rules match the documented dependency direction exactly.

**Blast radius.** Low (config only) but may surface existing violations (e.g. MOD-5) that must be
fixed or explicitly waived first.

---

## MOD-8 — Retire or quarantine the legacy desktop renderer · P2

**Problem / evidence.** Two desktop renderers coexist: the active `apps/desktop/renderer-revamp/`
and the legacy `apps/desktop/renderer/` (`src/App.tsx`, 621 lines). Startup selects the renderer via
`TLC_UI_MODE` (`apps/desktop/electron/main/index.ts:31-33`), and the legacy smoke test must force
`TLC_UI_MODE=legacy`. Maintaining two renderers doubles the desktop UI surface and confuses the
"four UI layers" model.

**Proposed change.** Decide and document the legacy renderer's fate: either (a) remove it and the
`legacy` mode once revamp parity is confirmed, or (b) quarantine it clearly as deprecated with a
removal date. Update `scripts/check-structure.mjs` (it still requires the legacy
`renderer/features/*` tree) and the related smoke tests accordingly.

**Acceptance criteria.**
- One active desktop renderer, or an explicit documented deprecation with a removal plan.
- Structure gate and smoke tests reflect the decision; no dead `TLC_UI_MODE` branches remain if removed.

**Blast radius.** Medium if removed (startup + structure gate + tests). Low if only quarantined/documented.

---

## Dependency map for these items

```
MOD-3 (ui-contracts) ──► MOD-4 (ui-logic) ──► UI-1/UI-2 (component + CSS split)
MOD-1 (composition root) ──► MOD-2 (operation registry) ──► MOD-6 (Teams stub)
MOD-5 (web↔desktop decoupling) ──► MOD-7 (enforce boundaries in lint/gate)
MOD-8 (legacy renderer) is independent
```

Recommended order: MOD-1 → MOD-2 (highest leverage, unblock Teams), then MOD-3 → MOD-4 (unblock UI
work), then MOD-5 → MOD-7 (lock the boundaries), with MOD-6 and MOD-8 opportunistic.
