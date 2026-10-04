# Code / Refactoring / Optimization / Tests

## Status

**Capture only — do not implement from this document without explicit approval and scoping.**
This is a deep-research baseline of the current code base and a neatly implementable backlog.
It follows the same "planning capture only" convention as [`docs/TODO.md`](../TODO.md) and
[`docs/Folder-structure.md`](../Folder-structure.md). Each work item is written so that it can be
picked up, scoped, and implemented independently later.

## Why this document exists

The request was to research the code base deeply and capture four things so they can be
implemented later, and to turn the durable rules into repository instructions that major
check-ins must follow:

1. **Code evaluation & modularization** — keep a stable backend, a stable orchestrator /
   middle-level harness, and isolate change to the four UI layers (Desktop, VS Code extension,
   Web, and Teams — stubbed for now). See [`01-modularization.md`](01-modularization.md).
2. **UI layout analysis** and optimizations. See [`02-ui-layout.md`](02-ui-layout.md).
3. **Performance improvements.** See [`03-performance.md`](03-performance.md).
4. **More robust tests** across backend, orchestrator/harness, functional e2e, and UI
   (shell/VS Code extension, desktop, web), plus the test types currently missing. See
   [`04-testing-strategy.md`](04-testing-strategy.md).

The durable behavioral rules are captured in [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md)
so that major changes are reviewed against them.

## How to read the backlog

Every work item uses this shape:

- **ID** — stable identifier (e.g. `MOD-3`, `TEST-7`) for cross-referencing in issues/PRs.
- **Problem / evidence** — what is wrong today, with concrete `path:line` citations.
- **Proposed change** — *what* to do, not *how* to code it.
- **Acceptance criteria** — how we know it is done.
- **Blast radius** — how risky the change is and which layers it touches.

Items are grouped by area and tagged with a priority: **P0** (do first / highest leverage),
**P1** (next), **P2** (opportunistic). Priorities are relative guidance, not commitments, and
carry no time estimates.

## Architecture baseline (as-is)

The repository is a TypeScript/Node monorepo (npm workspaces) with a deliberately layered design
already described in [`docs/Folder-structure.md`](../Folder-structure.md). The research confirms the
intended layering largely holds, with specific erosion points called out below.

```
          ┌───────────────────────── UI layers (allowed to diverge) ─────────────────────────┐
          │                                                                                   │
   Desktop (Electron renderer)   VS Code extension webview      Web (served desktop build)   Teams (absent)
   apps/desktop/renderer-revamp  apps/vscode-extension/webview  apps/web + apps/desktop/dist   —  (to stub)
          │                                   │                           │                     │
          └───────── host wiring (one composition root per surface — currently duplicated) ─────┘
                                              │
                         Orchestrator / middle-level harness  (should stay stable, shared)
                         packages/orchestrator  (ThinSliceOrchestrator, WorkflowHost, runtime)
                                              │
                         Backend  (should stay stable, shared)
                         packages/common (contracts)   packages/connectors   packages/agents
                                              │
                         Enterprise sources: MSX/Dataverse, SharePoint/MCEM, Foundry agents
```

Key facts established by the research (full detail in the area documents):

- **Backend and orchestrator are already shared** across all three live hosts. `ThinSliceOrchestrator`
  (`packages/orchestrator/index.ts`, ~14 operations) and the `WorkflowHost` interface
  (`packages/orchestrator/workflows/host.ts`) are reused by Desktop, Web, and VS Code. This is the
  stable core worth protecting.
- **The host *wiring* is duplicated**, not the orchestrator itself. The same composition
  (create `LiveMsxConnector`, `LocalPdfMcemGuidanceConnector`, `createFoundryOpenAIClient`, the
  four `FoundryPromptAgent` bindings, `createLivePlayWorkflowHost`) is hand-assembled three times:
  `apps/desktop/electron/main/index.ts`, `apps/web/src/runtime.ts`, and
  `apps/vscode-extension/src/live-provider*.ts`.
- **The transport surface is duplicated** three ways: Electron IPC (~20 `ipcMain.handle` handlers in
  `apps/desktop/electron/main/index.ts`), HTTP routes (`apps/web/src/app.ts`, ~22 routes), and the
  webview bridge dispatch (`apps/vscode-extension/src/host-router.ts`, 23 cases). Parity is asserted
  only for workflow operations by `tests/unit/hosts/workflow-transport-parity.test.ts`.
- **UI logic is duplicated** between the Desktop renderer and the VS Code webview (markdown
  formatting, prompt catalog, sort helpers, view types, sample data), while only discovery filter
  controls are genuinely shared via `apps/shared/`.
- **Two UI mega-files dominate:** `apps/desktop/renderer-revamp/src/App.tsx` (**1,599 lines**,
  **79** `useState`) and `apps/vscode-extension/src/webview/app.tsx` (**1,334 lines**, **59**
  `useState`); plus two large stylesheets (**2,272** and **1,620** lines).
- **Teams has no surface** — the only "teams" hits are sample opportunity data ("Teams Phone") and
  "deal team" domain terms. A stub is required.
- **Tests are broad but uneven.** Common/orchestrator are well covered; several declared test
  directories are empty (`tests/security`, `tests/evaluation`, `tests/unit/agents`,
  `tests/integration/agents`, `tests/integration/desktop`); golden-scenario files exist but are only
  schema-validated, never behaviorally executed; CI does not run Playwright e2e and sets no coverage
  thresholds.

## Cross-cutting principles (the rules)

These are the durable rules distilled into [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md).
They exist to protect the stable core while letting the UI layers move quickly.

1. **Stable backend.** `packages/common`, `packages/connectors`, and `packages/agents` change behind
   versioned contracts. Breaking a contract requires a `contractVersion` / `workflowContractVersion`
   bump and updated contract tests.
2. **Stable orchestrator / harness.** `packages/orchestrator` is the one middle layer shared by every
   host. New capabilities are added here once and exposed identically to all hosts; transport parity
   must be preserved.
3. **UI isolation.** Only the four UI layers may diverge in presentation. Shared *logic* (markdown,
   prompts, sorting, view types, sample data) belongs in a shared package, not copied per surface.
4. **One composition root per host.** Connector/agent/host assembly is wiring, not business logic;
   it should be built by shared factories, not re-typed in each app.
5. **Dependency direction is one-way** (UI → host wiring → orchestrator → agents/connectors →
   common). Common never imports upward; UI never imports connectors directly; agents never call
   other agents.
6. **Tests mirror the layer you touched.** A change to a layer updates that layer's tests; major
   check-ins run `npm run validate:major`.
7. **Teams stays a stub** until explicitly scoped; do not scatter Teams-specific branches through the
   shared code.

## Consolidated backlog (index)

Priorities are relative. See each area document for full detail.

| ID | Area | Title | Priority |
| --- | --- | --- | --- |
| MOD-1 | Modularization | Extract a shared host **composition root** (connector/agent/workflow-host factories) | P0 |
| MOD-2 | Modularization | Define a single **operation registry** and drive all three transports from it | P0 |
| MOD-3 | Modularization | Create `packages/ui-contracts` (browser-safe view types) to kill duplicated webview types | P1 |
| MOD-4 | Modularization | Create `packages/ui-logic` for shared markdown/prompt/sort/sample-data helpers | P1 |
| MOD-5 | Modularization | Remove web→desktop/electron import coupling (shared document/email module) | P1 |
| MOD-6 | Modularization | Add an enforced **Teams stub** surface boundary | P2 |
| MOD-7 | Modularization | Enforce dependency-direction rules in ESLint and extend the structure gate | P1 |
| MOD-8 | Modularization | Retire or quarantine the legacy desktop renderer | P2 |
| UI-1 | UI layout | Decompose the two App mega-components into feature/blade components | P0 |
| UI-2 | UI layout | Split the monolithic stylesheets and adopt shared design tokens | P1 |
| UI-3 | UI layout | Introduce scoped UI state (context/store) to stop prop-drilling and over-render | P1 |
| UI-4 | UI layout | Formalize responsive breakpoints and a documented layout grid | P2 |
| UI-5 | UI layout | Accessibility pass (focus order, roles, keyboard, contrast) | P1 |
| UI-6 | UI layout | Virtualize long lists/tables (portfolio, plays queue, discovery) | P2 |
| PERF-1 | Performance | Add TTL + explicit invalidation to the MSX portfolio cache | P0 |
| PERF-2 | Performance | Cache the per-user orchestrator in the web host (not per request) | P1 |
| PERF-3 | Performance | Harden web host-cache eviction/disposal (timeout + logging) | P1 |
| PERF-4 | Performance | Capture the before/after latency benchmark the perf doc defers | P1 |
| PERF-5 | Performance | Reduce UI bundle/render cost (code-split, memoize, lazy routes) | P2 |
| PERF-6 | Performance | Persist/aggregate performance telemetry beyond fire-and-forget logs | P2 |
| TEST-1 | Tests | Behavioral **golden-scenario evaluation harness** for the four agents | P0 |
| TEST-2 | Tests | Backend unit tests for agents + MSX live connector caching/paging | P0 |
| TEST-3 | Tests | Orchestrator/harness: full transport parity + host lifecycle tests | P0 |
| TEST-4 | Tests | Functional e2e coverage incl. web-live smoke and milestone/stage flows | P1 |
| TEST-5 | Tests | UI component/interaction tests (DOM env) for desktop, web, VS Code webview | P1 |
| TEST-6 | Tests | Security test suite (IPC/CORS trust, query guard, token redaction, injection) | P0 |
| TEST-7 | Tests | Accessibility tests (axe) for desktop and web | P1 |
| TEST-8 | Tests | Performance/benchmark tests with baselines | P2 |
| TEST-9 | Tests | Coverage thresholds + run e2e/smoke in CI | P1 |
| TEST-10 | Tests | Fill/clean the declared-but-empty test directories; align structure gate | P2 |

## Guardrails for implementing any of the above

- Make the smallest change that fully addresses one item; do not bundle unrelated refactors.
- Preserve public contracts unless the item explicitly versions them.
- Keep `npm run phase0:check` and `npm run validate:major` green.
- Run new dependencies through the GitHub advisory check before adding them.
- Update the relevant area document and this index when an item lands.

## Source material

- [`docs/Folder-structure.md`](../Folder-structure.md) — the intended module layout and dependency rules.
- [`docs/performance/performance-optimization.md`](../performance/performance-optimization.md) — the prior perf pass and benchmark procedure.
- [`docs/decisions/`](../decisions/) — ADRs 0001 (Electron MVP), 0002 (local orchestrator + Foundry agents), 0003 (hosted web BFF).
- [`docs/TODO.md`](../TODO.md) — existing prioritized backlog (UI revamp, SharePoint, LinkedIn, Seismic, Teams/email automation).
