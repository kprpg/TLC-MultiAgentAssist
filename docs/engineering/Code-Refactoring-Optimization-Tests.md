# Code / Refactoring / Optimization / Tests

## Status

**Capture only — do not implement from this document without explicit approval and scoping.**
This is a deep-research baseline of the current code base and a neatly implementable backlog.
It follows the same "planning capture only" convention as [`docs/TODO.md`](../TODO.md) and
[`docs/Folder-structure.md`](../Folder-structure.md). Each work item is written so that it can be
picked up, scoped, and implemented independently later.

## Why this document exists

This is the **single comprehensive capture** requested: a deep evaluation of the code base with
analysis **and** recommendations across **five areas**, written so each recommendation can be picked
up and implemented later. Parts 1–5 below hold the inline analysis; the companion documents hold the
full per-item detail (problem/evidence with `path:line`, proposed change, acceptance criteria, blast
radius). The five areas are:

1. **Code modularization** — what is modular today and where it has eroded; keep a stable backend, a
   stable orchestrator/middle-level harness, and isolate change to the UI layers (Desktop, VS Code
   extension, Web, Teams-stub). See [Part 1](#part-1--code-modularization) · deep dive
   [`01-modularization.md`](01-modularization.md).
2. **Refactoring & re-organization by layer** — a layered view (UI Layer / Middle Layer —
   orchestrator & harness / Data & backend layer) of the current tree and a proposed target
   structure. See [Part 2](#part-2--refactoring--re-organization-by-layer).
3. **Performance optimizations / improvements.** See [Part 3](#part-3--performance-optimizations) ·
   deep dive [`03-performance.md`](03-performance.md).
4. **UI improvements.** See [Part 4](#part-4--ui-improvements) · deep dive
   [`02-ui-layout.md`](02-ui-layout.md).
5. **More robust tests** across backend, orchestrator/harness, functional e2e, and UI (VS Code
   extension, desktop, web) plus the missing test types. See [Part 5](#part-5--tests) · deep dive
   [`04-testing-strategy.md`](04-testing-strategy.md).

The durable behavioral rules distilled from all of this are captured in
[`.github/copilot-instructions.md`](../../.github/copilot-instructions.md) so that major check-ins are
reviewed against them.

## Executive summary (verdict per area)

| Area | Verdict | Headline evidence |
| --- | --- | --- |
| **1. Modularization** | Solid core, eroded edges | Backend contracts versioned (`contractVersion`, `workflowContractVersion`); `ThinSliceOrchestrator` + `WorkflowHost` shared by all 3 hosts. But host **wiring** is copy-pasted 3× and the **transport surface** is re-listed per host (~20 IPC / ~22 HTTP / 23 bridge). |
| **2. Layer re-org** | Middle-layer concerns leak into UI apps | Composition + transport live inside each app; UI logic/types duplicated between desktop & webview; `apps/web` imports `apps/desktop/electron` internals. Target: lift composition/registry + shared UI code into packages. |
| **3. Performance** | Good baseline, cache gaps | Startup non-blocking, one shared Foundry client, process caches + phase timing exist. But MSX portfolio cache has **no TTL/invalidation**, and the web host rebuilds the orchestrator **per request**. |
| **4. UI** | Works, but monolithic | Two mega-components (`App.tsx` **1,599** lines / **79** `useState`; webview `app.tsx` **1,334** / **59**) and two monolithic stylesheets (**2,272** / **1,620** lines); ad-hoc breakpoints; partial a11y. |
| **5. Tests** | Broad but uneven | Common/orchestrator well covered; golden scenarios only schema-validated (never executed); `tests/security` & `tests/evaluation` empty; CI runs no Playwright e2e and sets no coverage thresholds; node env (no DOM). |

Priority first moves (P0): **MOD-1** (composition root) + **MOD-2** (operation registry) to stop the
3× drift, **PERF-1** (MSX cache TTL/invalidation), **UI-1** (decompose the mega-components), and
**TEST-1/2/3/6** (golden-scenario, backend, transport-parity, security). Full list in the
[consolidated backlog](#consolidated-backlog-index).



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

## Part 1 — Code modularization

Full detail and per-item acceptance criteria: [`01-modularization.md`](01-modularization.md).

**What is already modular (protect it).**
- **Backend contracts are centralized and versioned.** `packages/common` exposes Zod-validated
  contracts with explicit version literals — `contractVersion` (`packages/common/contracts/index.ts`)
  and `workflowContractVersion` (`packages/common/contracts/workflows.ts`); hosts and the orchestrator
  re-parse at the boundary.
- **Connectors isolate source specifics.** `packages/connectors/common/index.ts` defines the
  `MsxConnector` / `McemGuidanceConnector` interfaces; implementations hide OData, PDF parsing,
  retries, and tokens.
- **One shared thin-slice orchestrator.** `ThinSliceOrchestrator` (`packages/orchestrator/index.ts`,
  ~14 operations) and `SharedWorkflowHost`/`WorkflowHost` (`packages/orchestrator/workflows/host.ts`)
  are reused by Desktop, Web, and VS Code.
- **Agent logic is minimal and local only where it must be.** Only `mcem-coach` has local TS logic
  (`evaluateMcemProgress`, ~111 lines); the other three are Foundry-prompt agents with no `src/`.

**Where it has eroded (fix it).**
1. **Host wiring is copy-pasted across the three hosts** — the same connector/agent/workflow-host
   assembly is hand-written in `apps/desktop/electron/main/index.ts:100-175`, `apps/web/src/runtime.ts:18-107`,
   and `apps/vscode-extension/src/live-provider*.ts`; the capability tuple
   `['account-pulse','mcem-coach','pursuit-executive','risk-solution-play']` is repeated. → **MOD-1**.
2. **The transport/dispatch surface is re-listed per host** — ~20 IPC handlers vs ~22 HTTP routes vs
   23 bridge cases, each repeating `assertTrustedSender`/auth + a Zod `parse`; parity is tested for
   workflow ops only. → **MOD-2**.
3. **UI logic & view types are duplicated** between Desktop and VS Code (the webview can't import
   Node-backed `packages/common`, so it re-declares `view-types.ts` and copies markdown/prompt/sort
   helpers + sample data). → **MOD-3** (ui-contracts), **MOD-4** (ui-logic).
4. **A UI layer imports another's internals** — `apps/web/src/app.ts:46-47` imports document/email
   builders from `apps/desktop/electron/main/*`. → **MOD-5**; enforce direction via **MOD-7**.
5. **Teams has no surface**, and **two desktop renderers coexist** (revamp + legacy selected by
   `TLC_UI_MODE`). → **MOD-6** (Teams stub), **MOD-8** (retire/quarantine legacy renderer).

---

## Part 2 — Refactoring & re-organization by layer

This is the layered view requested: map the current tree onto **UI Layer / Middle Layer (orchestrator
& harness) / Data & backend layer**, then propose a target re-organization that moves the leaked
concerns into the right layer. It synthesizes the MOD items; no new recommendations are introduced
here beyond the structure itself.

### 2.1 The three layers, as the code sits today

| Layer | Responsibility | Lives in today | Layer-cleanliness |
| --- | --- | --- | --- |
| **UI Layer** | Presentation & interaction only | `apps/desktop/renderer-revamp` (active), `apps/desktop/renderer` (legacy), `apps/vscode-extension/src/webview`, `apps/web` (serves the desktop build), `apps/shared` (discovery controls); Teams absent | 🟡 duplicated logic/types across desktop & webview; web depends on desktop internals |
| **Middle Layer — orchestrator & harness** | Intent routing, workflow execution, host composition, transport marshalling | `packages/orchestrator` (stable core) **plus** per-host composition + transport currently embedded in `apps/desktop/electron/main`, `apps/web/src/{runtime,app}.ts`, `apps/vscode-extension/src/{live-provider,host-router}` | 🟡 orchestrator is clean & shared, but composition/transport is copy-pasted inside each UI app |
| **Data & backend layer** | Contracts, source access, agent business logic | `packages/common` (contracts), `packages/connectors` (MSX/Dataverse/SharePoint/MCP), `packages/agents` | ✅ well isolated; ⚠️ MSX portfolio cache lacks TTL/invalidation (PERF-1) |

**Key insight:** the orchestrator itself is already a clean middle layer, but two *middle-layer*
responsibilities — **host composition** (wiring connectors/agents/workflow host) and **transport**
(IPC/HTTP/bridge marshalling) — currently live **inside the UI apps**, duplicated three times. The
refactor is mostly about relocating those two concerns out of the UI layer into shared middle-layer
packages, and lifting shared presentation code out of the individual UIs.

### 2.2 Current → target mapping

| Concern | Today (duplicated/leaked) | Target home (layer) |
| --- | --- | --- |
| Connector/agent/workflow-host assembly | Inline in each host (3×) — MOD-1 | Factories beside owners in `packages/connectors/*` & `packages/orchestrator/*`, assembled by a shared composition root (**middle**) |
| Operation → transport mapping | ~20 IPC / ~22 HTTP / 23 bridge (3×) — MOD-2 | One declarative **operation registry** that generates all three transports (**middle**) |
| View types / schemas | `apps/vscode-extension/src/webview/view-types.ts` re-declares common shapes — MOD-3 | `packages/ui-contracts` (browser-safe) consumed by all UIs (**shared, UI-facing**) |
| Markdown / prompt catalog / sort / sample data | Copied in desktop & webview — MOD-4 | `packages/ui-logic` (browser-safe) (**shared, UI-facing**) |
| Document/email builders | `apps/web` imports from `apps/desktop/electron` — MOD-5 | `packages/documents` (or `packages/common/documents`) consumed by both (**data/shared**) |
| Dependency-direction enforcement | Documented only, not enforced — MOD-7 | ESLint import-boundary rules + extended `check-structure.mjs` |
| Teams surface | Absent — MOD-6 | `apps/teams/` stub depending only on the shared middle layer + `ui-contracts`/`ui-logic` |
| Legacy desktop renderer | `apps/desktop/renderer` + `TLC_UI_MODE` — MOD-8 | Retire or quarantine with a removal plan |

### 2.3 Proposed target structure (abbreviated)

```text
packages/
  common/          # contracts, schemas, telemetry        (DATA/BACKEND)
  connectors/      # MSX / Dataverse / SharePoint / MCP  + connector factories (MOD-1)
  agents/          # agent logic + Foundry prompts/manifests
  orchestrator/    # ThinSliceOrchestrator + WorkflowHost + agent/host factories (MOD-1)   (MIDDLE)
  host-runtime/    # NEW: operation registry (MOD-2) + composition root that assembles the factories
  documents/       # NEW: transport-neutral .docx/.eml builders (MOD-5)
  ui-contracts/    # NEW: browser-safe view types/schemas (MOD-3)                          (SHARED UI-FACING)
  ui-logic/        # NEW: markdown / prompt catalog / sort / sample data (MOD-4)
apps/
  desktop/         # Electron main = thin composition over host-runtime; renderer-revamp = thin UI   (UI)
  web/             # HTTP host = thin composition over host-runtime; serves desktop build
  vscode-extension/# extension host = thin composition; webview = thin UI
  shared/          # genuinely cross-UI glue (discovery) — folds into ui-logic where possible
  teams/           # NEW: stub only (MOD-6)
```

New package names (`host-runtime`, `documents`, `ui-contracts`, `ui-logic`) are indicative; the
binding constraint is the **layer** each concern lands in and the one-way dependency direction below.
Connector/agent factories stay beside their owners (per MOD-1); `host-runtime` only *assembles* them.

### 2.4 Dependency direction (one-way, enforced by MOD-7)

```text
UI layer (renderers/webview/teams)
    ──► ui-contracts, ui-logic           (browser-safe, no Node)
    ──► host bridge/transport only
Middle layer (host-runtime → orchestrator)
    ──► agents ──► connector interfaces / supplied evidence
    ──► connector implementations ──► enterprise sources
Data/backend (common) never imports upward; no UI → connector import; no app → app import.
```

**Sequencing:** MOD-1 → MOD-2 (relocate composition + transport out of the UI apps), then MOD-3 →
MOD-4 (lift shared UI code), then MOD-5 → MOD-7 (decouple web↔desktop and lock the boundaries in
lint), with MOD-6 (Teams stub) and MOD-8 (legacy renderer) opportunistic.

---

## Part 3 — Performance optimizations

Full detail: [`03-performance.md`](03-performance.md).

**Baseline to preserve.** Startup no longer blocks on a discarded Foundry call (deterministic local
MCEM diagnostic from cached context); one shared Foundry client across the four agents; process-level
caches (MSX portfolio, MCEM PDF parse, MSX token until ~5 min before expiry); phase timing via
`measurePerformance` wrapping `agent.context.msx|mcem` and `agent.invoke.<capability>`.

**Highest-leverage issues.**
- **PERF-1 (P0)** — MSX portfolio cache has **no TTL/invalidation** (`packages/connectors/msx/live.ts`),
  so long-lived sessions (especially the web host's per-user instances) risk stale reads. Add bounded
  TTL + explicit invalidation on mutations.
- **PERF-2 (P1)** — the web host rebuilds a `LiveMsxConnector` + `ThinSliceOrchestrator` on **every**
  request (`apps/web/src/runtime.ts:56-59`), discarding warm caches; cache per `clientPrincipal` like
  the workflow host already does.
- **PERF-3 (P1)** — host-cache eviction `dispose()` has no timeout/logging
  (`apps/web/src/runtime.ts:109-118`) → possible stall/leak; make disposal defensive.
- **PERF-4 (P1)** — no before/after latency benchmark captured; implement the perf doc's procedure as
  an opt-in benchmark with a committed baseline.
- **PERF-5 (P2)** — desktop UI over-renders and the bundle isn't code-split (depends on UI-1/UI-3).
- **PERF-6 (P2)** — phase telemetry is fire-and-forget only; add an optional aggregating/export sink
  that preserves the "no prompt text/names/ids/tokens" rule.

---

## Part 4 — UI improvements

Full detail: [`02-ui-layout.md`](02-ui-layout.md).

**Inventory.** Desktop renderer-revamp is a three-blade workspace (Accounts / center tabs
Portfolio·Workflows·Discover / Actions) under a 44px command bar, React 19.2 + Fluent UI v9. The VS
Code webview (app header, plays rail, results, guidance drawer) is more modular (~24 files, uses
`useCallback`/`useMemo`). **Web has no bespoke UI — it serves the compiled desktop build**, so every
desktop layout change ships to web automatically. Teams is absent.

**Headline problems & recommendations.**
- **UI-1 (P0)** — two mega-components (`App.tsx` **1,599** lines/**79** `useState`; webview `app.tsx`
  **1,334**/**59**) mix layout, state, data access, and dialogs. Decompose into feature components
  (CommandBar, AccountsBlade, CenterTabs/tabs, ActionsBlade, dialogs; PlaysRail/PlaysResults/
  GuidanceDrawer), reusing `packages/ui-logic`.
- **UI-2 (P1)** — two monolithic stylesheets (**2,272** / **1,620** lines) with parallel tokens; extract
  shared design tokens + component styles, split per feature.
- **UI-3 (P1)** — state sprawl + prop-drilling causes broad re-renders; introduce scoped
  context/stores + `React.memo` boundaries.
- **UI-4 (P2)** — ad-hoc `max-width` breakpoints (web inherits desktop-window assumptions); formalize a
  documented breakpoint scale/grid as shared tokens.
- **UI-5 (P1)** — accessibility is partial; audit focus order/roles/keyboard/contrast (pairs with
  TEST-7 axe).
- **UI-6 (P2)** — long lists (portfolio, plays queue, milestones, discovery) render fully; virtualize
  after UI-1/UI-3.

---

## Part 5 — Tests

Full detail and the test-type × layer gap table: [`04-testing-strategy.md`](04-testing-strategy.md).

**As-is.** Vitest (Node env — **no DOM**; React asserted via `renderToStaticMarkup`), Playwright
revamp + desktop smoke, and the VS Code extension test CLI. CI (`.github/workflows/ci.yml`, push to
`master` + `workflow_dispatch`, no `pull_request`) runs `phase0:check` + coverage but **no Playwright
e2e** and **no coverage thresholds**. Golden scenarios exist but are only schema-validated, never
executed. `tests/security`, `tests/evaluation`, `tests/unit/agents`, `tests/integration/agents`,
`tests/integration/desktop` are empty.

**Recommendations, mapped to the requested taxonomy.**
- **4.1 Backend** — **TEST-2 (P0)** agent logic (all `evaluateMcemProgress` transitions) + MSX
  connector caching/paging/error fixtures; **TEST-1 (P0)** behavioral **golden-scenario** harness.
- **4.2 Middle layer (orchestrator/harness)** — **TEST-3 (P0)** full transport-parity for **all**
  operations (not just workflows) + host-lifecycle (eviction/cancellation/disposal) tests.
- **4.3 Functional e2e** — **TEST-4 (P1)** web-live smoke paralleling desktop + one e2e per primary
  journey on desktop and web.
- **4.4 UI tests** — **TEST-5 (P1)** DOM-environment component/interaction tests for **4.4.1** VS Code
  webview (shell extension), **4.4.2** desktop, **4.4.3** web (today only static markup is checked).
- **Missing types you'd otherwise skip** — **TEST-6 (P0)** security (IPC/CORS trust, query guard, MCP
  policy, token/PII redaction, injection); **TEST-7 (P1)** accessibility (axe + keyboard); **TEST-8
  (P2)** performance benchmarks; automate visual regression + **TEST-9 (P1)** coverage thresholds &
  run e2e/smoke in CI; **TEST-10 (P2)** fill the empty test dirs and align the structure gate.

---

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
