# Proposed Folder Structure

## Status

This structure is proposed for approval before implementation begins. Creating this document does not scaffold application modules or select implementation dependencies.

## Design Intent

The repository should use a modular monorepo. This keeps the Electron client, orchestration logic, agents, connectors, shared contracts, and tests independently identifiable while avoiding the operational overhead of splitting the MVP into separately deployed services.

The structure supports these boundaries:

- The Electron renderer owns presentation and user interaction only.
- The trusted Electron main process owns authentication, IPC handling, and privileged local operations.
- The orchestrator resolves intent and coordinates agent execution.
- Each agent owns one business capability and its prompts and policies.
- Connectors own source-specific authentication, API calls, retries, and response mapping.
- Common code contains stable cross-module contracts and utilities, not business logic belonging to an agent.
- Tests mirror production module boundaries.

## Repository Layout

### Product feedback intake

- [Product Backlog](./Product-Backlog.md) records incoming user requests, ideas,
  screenshots, triage decisions, and acceptance criteria; capture is not implementation approval.
- [Backlog screenshot assets](./media/product-backlog/) contains redacted,
  ID-labelled references linked from each entry. Sensitive originals stay outside Git.

### Dashboard design proposals

- [Momentum & Focus Dashboard Proposal](./architecture/Momentum-Focus-Dashboard-Proposal.md)
  records the proposed SSP/SE priority, traction and signal-richness dashboard; it is not an
  implementation status report.
- [Illustrative mockup assets](./media/momentum-focus-dashboard/) contains the synthetic PNG
  preview and editable SVG referenced by the proposal.

### Knowledge connector foundation

The read-only knowledge operation is implemented in these focused modules:

```text
packages/common/contracts/knowledge.ts        Independent v1.0 query/evidence/result contracts
packages/common/configuration/knowledge-sources.ts
                                             Seismic connection and retrievable-property mappings
packages/common/fixtures/knowledge.ts         Canonical offline content/PPT search fixtures
packages/connectors/common/knowledge.ts       KnowledgeSource interface and typed source errors
packages/connectors/seismic/graph.ts          Scoped delegated Microsoft Graph external-item search
packages/connectors/seismic/mcp.ts            Explicitly unavailable direct-MCP placeholder
packages/orchestrator/knowledge-search.ts     Shared provider composition and source dispatch
apps/desktop/electron/main/knowledge-ipc.ts   Validated Desktop knowledge operation adapter
docs/Knowledge-Search-Connectors.md            Phased rollout, authentication and future UI contract
```

Desktop, Web, VS Code, and the shared operation catalog expose the same operation.
No content-search UI or MCEM portal connector is added. See the
[knowledge connector guide](./Knowledge-Search-Connectors.md).

### Working session pack

Beside **Run MCEM Coach** (VS Code) and **Meeting capture** (Desktop, Web, Teams), the
**Working session** control prepares decks, a Microsoft Learn document set and draft Bicep/ARM
templates for a chosen opportunity and milestone, into `Documents\TLC\<Opportunity - Milestone>`
(a zip download on Web and Teams). One orchestrator service, four transports, one shared UI:

```text
packages/common/contracts/working-session.ts   Strict v1.0 topic/prepare/result contracts (browser-safe)
packages/orchestrator/working-session/
  topic.ts                 Rule catalog + optional model topic deduction (untrusted text, schema-checked)
  learn.ts                 Microsoft Learn MCP client, page gathering, Markdown set and index
  decks.ts                 Local folders, public GitHub, Seismic, Microsoft 365 deck sources and ranking
  pptx-draft.ts            Labelled DRAFT outline deck when no existing deck is found
  iac.ts                   Bicep templates per scenario, static validator, model path with fallback
  bicep-cli.ts             Optional Bicep -> ARM compile (Bicep CLI or az bicep)
  sinks.ts / outputs.ts    FolderSink (no overwrite, no link escape) and ZipSink; Documents resolution
  download-store.ts        Short-lived per-user holding area for hosted zips
  foundry-model.ts         Strict structured-output model adapter
  service.ts               WorkingSessionService, factory and deck configuration from the environment
apps/shared/working-session/                   Launcher component, pure model, CSS, browser download helper
apps/desktop/electron/main/working-session-ipc.ts   Validated IPC adapter (opens only Documents\TLC folders)
apps/web/src/working-session.ts                Hosted resolver (zip only, per-user download)
apps/teams/src/working-session.ts              Teams host (zip only, per-principal download)
apps/vscode-extension/src/working-session.ts   Extension host composition (writes to Documents\TLC)
```

See the [working session runbook](./runbooks/working-session.md).

### Teams implementation additions

The original proposal below is retained as historical context. The Teams development
surface adds the following focused areas while preserving one shared backend/harness:

```text
apps/teams/src/                       Teams composition, verified HTTP/bot transport
apps/teams/src/runtime-resources.ts   Local SQLite/CLI or Azure Table/managed identity
apps/teams/src/data-mode-router.ts    Per-page Sample/Live routes over isolated canonical services/stores
apps/teams/src/performance.ts         Opt-in technical timing and async HTTP correlation; no payload logging
apps/teams/src/native-identity.ts     Native SDK identity/resource tokens; no HTTP interaction
apps/teams/src/cli-identity.ts        Verified current CLI user; private read-only MSX, no FTE inference
apps/teams/src/native-connection.ts   Per-user native composition, private state and owner control
apps/teams/src/local-owner-control.ts
apps/teams/src/local-pairing.ts       Windows owner channel and ephemeral local page admission
apps/teams/src/launch-status.ts       Exact runtime/build and authenticated client readiness monitor
apps/teams/src/client/                Personal/channel/meeting presentation
                                     Focused scope, opportunity, guidance, record actions,
                                     Plays/result, navigation and responsive-disclosure modules
                                     Native connection panel and memory-only local API client
apps/teams/src/client/discovery.tsx   Domain tabs, shared customer filters/sort and reviewed memberships
apps/teams/src/client/use-data-mode.ts
apps/teams/src/client/data-mode-switcher.tsx
                                     Personal mode selector, discard confirmation and memory-only auth reuse
apps/teams/src/client/discovery.css   Teams-themed compact discovery table and responsive layout
apps/teams/src/client/mcem-stage-board.tsx
                                     Account-scoped Teams selection over shared MCEM stage columns
apps/teams/src/client/manual-transcript-input.tsx
                                     Bounded paste/upload input and scope-safe extraction
apps/teams/src/client/meeting-capture.ts
                                     Shared capture result validation and actionable source errors
apps/teams/src/client/response-actions.tsx
                                     Top-right Word/unsent email downloads for Guidance and meeting proposals
apps/teams/src/client/workspace-boundary.tsx
                                     Explicit recovery for lazily loaded workspace failures
apps/desktop/electron/main/portfolio-ipc.ts
                                     Validated aggregate portfolio/index IPC over the shared orchestrator
apps/teams/.env.native.example       Safe per-user native configuration, not real credentials
apps/teams/.env.cli.example          Safe existing-user CLI configuration, not tokens/secrets
apps/shared/                         Browser-safe prompt/Markdown and existing UI reuse
apps/shared/font-scale.ts            Shared additional 0.95 font factor and pure Fluent theme-font scaling
apps/shared/postcss-font-scale.ts     Font-only build transform shared by all client Vite builds
apps/shared/typography.css            Low-specificity native-control fallback; no layout or icon scaling
apps/shared/transcript-file.ts       Shared UTF-8 VTT/text reader for Desktop/Web, VS Code and Teams
                                     Shared Portfolio controls, sorting and Next Best Actions
apps/shared/pane-resize-handle.tsx   Accessible shared three-dot width divider for all four surfaces
apps/shared/resizable-split.tsx      Responsive two-region Portfolio sizing without unmounting hidden drafts
apps/shared/pane-resizing.css        Blue hover/drag divider lines and native horizontal pane scrollbars
apps/shared/guidance-pane.tsx        Shared Guidance maximize/restore control and VS Code/Teams pane frame
apps/shared/guidance-pane.css        Temporary full-width split layout without unmounting neighboring panes
apps/shared/customer-email.ts        Browser-safe customer-email extraction excluding later internal sections
apps/shared/customer-email-actions.tsx
                                     Copy and human-reviewed unsent draft actions shared by all four surfaces
apps/shared/session-portfolio.ts     Memory-only, mode/session-scoped Portfolio/Discovery snapshots
                                     Shared lazy detail caching, local filtering and confirmed-write updates
apps/shared/operation-result-session.ts
                                     UI-session ownership of existing async calls; 20 completed results, scope isolation and private reset
apps/shared/use-operation-result.ts  Shared reactive result subscription and Meeting Capture review/restore behavior
apps/shared/workflow-polling.ts      Workflow-definition deadline plus bounded transport grace across UI transports
apps/shared/workflow-progress.tsx    Shared incomplete/partial/terminal Play result announcements
apps/shared/workflow-membership.tsx Shared All/My results controls, scoped loading and accessible disabled-action explanations
apps/shared/workflow-membership.css Shared membership toolbar and hover/keyboard tooltip styling
packages/common/contracts/workflow-membership.ts
                                     Strict results-view and current-membership contracts
packages/orchestrator/workflows/membership-projection.ts
                                     Browser-safe pure result projection; typed references and aggregate contributors
packages/orchestrator/workflows/membership-view.ts
                                     Current-user membership reads and guarded queue Guidance handoffs
apps/vscode-extension/src/foundry-sign-in.ts
                                     Prompt-owned sign-in budget shared by preflight and SDK token callbacks
apps/shared/session-cache.ts         Bounded reactive datasets, active-interest freshness and safe read retries
apps/shared/presentation-owner.ts    Host-owned cache composition and confirmed canonical patches
apps/shared/presentation-hooks.ts    Visible-interest subscriptions and original editor-field capture
apps/shared/mutation-sync.ts         Browser-safe pending overlays, private recovery and exact-source review
apps/shared/sync-status.tsx          Shared stale/last-checked and pending/conflict/unknown presentation
apps/vscode-extension/src/presentation-provider.ts
                                     One provider cache for native trees and recreated webviews
apps/shared/meeting-proposal-markdown.ts
                                     Shared browser-safe meeting proposal export format across surfaces
apps/shared/meeting-picker.tsx       Shared "Teams meeting" dropdown, lazy list hook and date/time labels (VS Code, Desktop/Web, Teams)
packages/common/configuration/meeting-sources.ts
                                     Delegated Graph scopes and window/limit for the recent-meeting list
packages/connectors/common/meeting-source.ts
                                     User-safe MeetingSourceError and messages shared by every UI
apps/shared/mcem-stages.ts           Browser-safe stage names and accountable role metadata
apps/shared/mcem-stage-board.tsx     Shared Desktop/Web/Teams stage columns and presentation
apps/shared/mcem-stage-board.css     Shared stage headers, cards, selection and gate styling
packages/common/contracts/workflow-output.ts
                                     Browser-safe existing workflow result/run-view schemas
packages/common/contracts/cache-sync.ts
                                     Independent strict v1.0 read-control, policy and asynchronous receipt contracts
packages/common/source-failure.ts    Preserve MSX denial/throttling status without replacing host policy errors
packages/common/contracts/local-connection.ts
                                     Native/owner protocol v1.0, CLI public profile v1.2,
                                     and independently versioned work-session renewal v1.0
packages/common/contracts/teams-launch.ts
                                     Separate strict v1.0 launch/build/client-readiness contracts
packages/common/contracts/teams-data-mode.ts
                                     Strict v1.0 runtime/initial/available modes and bounded API paths
packages/common/contracts/index.ts   Independently versioned v1.0 Portfolio index/workspace and all-domain Discovery snapshot contracts
packages/orchestrator/application-runtime.ts
packages/orchestrator/operations.ts   Shared composition and typed operation catalog
packages/orchestrator/task-agents.ts  Shared Foundry/sample/deterministic-live registries
packages/orchestrator/instant-draft.ts
                                     Deterministic evidence-based draft shown instantly while the model runs
packages/orchestrator/agent-evidence.ts
                                     Bounded evidence pack (comment history, notes, activities, milestone detail) and model-input serialization
packages/connectors/msx/evidence.ts  Pure helpers for MSX comment-history parsing and rich-text cleanup
packages/orchestrator/prewarm.ts      Best-effort Foundry token and MCEM guidance pre-warm
packages/orchestrator/workflows/registration.ts
                                     Approved workflow registration seam (schema-validated extension output)
packages/orchestrator/evaluation/golden-scenarios.ts
                                     Metadata-only golden-scenario evaluator (not-evaluated is never a pass)
packages/common/configuration/hosting-model.ts
                                     Declared single-instance hosting model and startup guard
apps/desktop/electron/main/task-agents.ts
                                     Desktop task-agent composition over the shared factory
apps/desktop/renderer-revamp/src/preview/
                                     Static-preview-only implementations, imported only by data-client.ts
scripts/check-import-boundaries.mjs   Import-boundary gate (baseline: scripts/import-boundary-baseline.json)
scripts/deploy-web-appservice.ps1     Shared live/sample App Service ZIP deployment entry point
scripts/web-sample-appservice.ps1     Sample-only slot, anonymous verification, promotion and guarded rollback helpers
scripts/smoke-web-release.mjs         Actual staged-host and remote anonymous sample verification
packages/common/contracts/inference.ts
                                     Browser-safe, independently versioned sample AI provenance and mode selection
packages/orchestrator/sample-inference.ts
                                     Sample-only real/offline AI composition; no live source wiring
packages/connectors/foundry/sample-budget.ts
                                     Persistent per-slot sample AI quotas and restricted inference transport
apps/shared/inference-status.tsx     Shared sample AI mode and fallback presentation
docs/runbooks/sample-foundry-ai.md   Cross-surface hybrid sample setup, credentials and limits
tests/fixtures/appservice-cli.mjs     Isolated stateful Azure/verification CLI double; never contacts Azure
tests/e2e/revamp/web-release.spec.ts  Actual Node-host SQLite sample browser and restart/reset journey
docs/architecture/Hosting-Model.md, Operational-Evidence.md
                                     Hosting constraints and executed vs planned evidence
apps/shared/agent-stream.ts           Browser-safe agent stream accumulator and NDJSON reader (all UIs)
                                     Desktop IPC acknowledges the validated terminal event before removing its listener
apps/shared/use-agent-run.ts          Shared React hook: instant draft, streamed text, final response, cancel
apps/shared/agent-response.tsx        Shared formatted agent replies and explicit, scoped follow-up conversation
apps/shared/agent-response.css        Theme-aware follow-up controls and response layout
apps/shared/agent-follow-up.ts        Closing-offer detection and bounded previous-response context
packages/common/contracts/agent-task-limits.ts
                                     Browser-safe prompt bound shared by agent request schemas and UI follow-ups
packages/orchestrator/collaboration/  Reviewed actions, bindings, events, state admission
packages/orchestrator/mutations/     Immediate confirmed admission, protected journal, actor/version and effect tracking
packages/connectors/graph/            Delegated meeting/transcript/subscription access
packages/connectors/teams/            Authoritative resource membership checks
packages/connectors/common/encrypted-document-store.ts
                                     Authenticated local state payload encryption
packages/connectors/common/mutation-state.ts
                                     Protected local key initialization and existing Azure Table receipt composition
packages/documents/                   Shared Word/email builders, not an app dependency
tests/unit/teams/                     Cumulative deterministic Teams slices
tests/e2e/teams/                      Actual host/browser journeys
tests/e2e/backend-performance/        Controlled all-four-host backend round-trip comparisons
tests/fixtures/performance/          Read-only Live-class fixtures and isolated production-preload host
playwright.performance.config.ts     Reproducible backend performance gate; no tenant/model calls
release-teams/                       Ignored generated installation/runtime archives
scripts/run-teams-local.ps1          Guided build/start/install/pair/verify; status and restart-free resume
scripts/teams-launch-session.ps1     Owned-run checks, exact-ZIP install and finish-line verification
scripts/teams-local-connection.ps1   Explicit native/CLI owner connect/approve/status/disconnect
```

The [Teams runbook](./runbooks/teams-app.md) defines the user-operated local-now,
Azure-later lifecycle, separate ZIP purposes, F5/opt-in HTTPS and open live gates. The
installation ZIP references the runtime; it does not execute the application itself.

### Original proposed layout

```text
TLC-MultiAgentAssist/
|-- apps/
|   `-- desktop/
|       |-- electron/
|       |   |-- main/                 # Trusted Electron process
|       |   |   |-- auth/
|       |   |   |-- ipc/
|       |   |   `-- bootstrap/
|       |   `-- preload/
|       `-- renderer/
|           |-- shell/
|           |-- pages/
|           |-- components/           # Reusable presentation components
|           |-- features/
|           |   |-- account-selector/
|           |   |-- conversation/
|           |   |-- source-health/
|           |   `-- feedback/
|           |-- hooks/
|           `-- services/
|
|-- packages/
|   |-- common/
|   |   |-- contracts/                # Versioned request/response contracts
|   |   |-- types/
|   |   |-- validation/
|   |   |-- errors/
|   |   |-- configuration/
|   |   `-- telemetry/
|   |
|   |-- orchestrator/
|   |   |-- routing/
|   |   |-- workflows/
|   |   |-- context/
|   |   |-- progress/
|   |   `-- policies/
|   |
|   |-- agents/
|   |   |-- account-pulse/
|   |   |   |-- prompts/
|   |   |   |-- policies/
|   |   |   `-- src/
|   |   |-- mcem-coach/
|   |   |   |-- prompts/
|   |   |   |-- policies/
|   |   |   `-- src/
|   |   |-- pursuit-executive/
|   |   |   |-- prompts/
|   |   |   |-- policies/
|   |   |   `-- src/
|   |   `-- risk-solution-play/
|   |       |-- prompts/
|   |       |-- policies/
|   |       `-- src/
|   |
|   `-- connectors/
|       |-- common/                   # Connector interfaces and evidence envelope
|       |-- msx/
|       |-- sharepoint/
|       |-- seismic/
|       `-- linkedin/
|
|-- tests/
|   |-- unit/
|   |   |-- common/
|   |   |-- orchestrator/
|   |   |-- agents/                   # One subfolder per agent
|   |   |-- connectors/               # One subfolder per connector
|   |   `-- desktop/
|   |-- integration/
|   |   |-- orchestrator/
|   |   |-- agents/
|   |   |-- connectors/
|   |   `-- desktop/
|   |-- contract/                     # Schema and handoff compatibility tests
|   |-- e2e/                          # Electron user journeys
|   |-- evaluation/                   # Golden prompts and scoring rubrics
|   |-- security/                     # Token, IPC, navigation, and logging tests
|   `-- fixtures/
|       |-- msx/
|       |-- sharepoint/
|       |-- seismic/
|       `-- linkedin/
|
|-- docs/
|   |-- PRD.md
|   |-- architecture/
|   |-- decisions/
|   |-- research/
|   `-- runbooks/
|-- scripts/
`-- package.json
```

## Module Responsibilities

### Desktop Application

`apps/desktop` contains the distributable Electron application. The renderer must not acquire tokens or call enterprise sources directly. The main process exposes a minimal, validated IPC surface through the preload layer.

Reusable visual elements belong in `renderer/components`. Components tied to a user workflow belong in the corresponding `renderer/features` folder. Pages compose features but should not contain connector or agent logic.

### Common

`packages/common` contains code that is genuinely shared across multiple modules, including versioned contracts, common types, validation, error definitions, configuration primitives, and telemetry interfaces.

Agent-specific rules, prompts, scoring, and domain decisions must remain in the owning agent. Source-specific models and authentication behavior must remain in the owning connector.

### Orchestrator

`packages/orchestrator` owns intent routing, workflow selection, execution context, progress reporting, cancellation, and partial-failure policy. It invokes agents through their public contracts and must not duplicate agent business logic.

### Agents

Each folder under `packages/agents` is an independently testable business module:

- `account-pulse`: weekly focus, prioritization, and account signals.
- `mcem-coach`: evidence-based MCEM stage diagnostics and progression guidance.
- `pursuit-executive`: executive briefs and 30/60-day pursuit plans.
- `risk-solution-play`: supported risks, mitigations, content recommendations, and solution packages.

Prompts and policies live with their owning agent so changes can be reviewed, versioned, and evaluated together with the corresponding implementation.

### Connectors

`packages/connectors` isolates source-specific behavior for MSX, SharePoint, Seismic, and LinkedIn. Each connector maps source responses into shared evidence contracts and owns its retry, throttling, authorization, and source error handling.

Agents consume connector interfaces or orchestrator-provided evidence. They must not embed HTTP calls, credentials, or source-specific queries.

## Dependency Direction

The current browser-safe shared UI modules in `apps/shared` include `portfolio-search.ts`, which supplies the same matching and result-limit rules to Desktop/Web and the VS Code webview. The extension's focused `portfolio-search.tsx` component owns search loading and interaction; `next-best-actions.tsx` renders MCEM recommendations and their cited evidence without changing the host or orchestrator contracts.

`add-customer.tsx` and `add-customer.css` provide the shared customer search/add dialog for both Portfolio and Discovery across Desktop, Web, and the VS Code webview. They use the existing host account-search and preference operations without importing Node-backed contracts into the webview.

`remove-customer.tsx` and `remove-customer.css` provide the shared tracked-customer
chooser, named confirmation, and contextual removal shortcut across those same UIs.
Removal reuses the existing account-visibility operation; Add customer's **Add again**
restores a removed account. The extension's `customer-removal.ts` owns the testable
native chooser/confirmation action and identifies successful bridge mutations for
tree refresh. Its focused webview `use-portfolio-refresh.ts` coordinates account
changes with search invalidation. These are presentation/refresh concerns, not a new
backend contract, delete endpoint, or cross-app preference service.

The [Account Discovery implementation notes](./Account-Discovery-Portfolio-Feasibility.md)
record the tested lookup/curation behavior. `packages/connectors/msx/account-search.ts`
validates external search responses and builds bounded literal typo queries; the shared
live connector owns metadata verification, delegated read-back and account preferences.
No host-specific orchestration or new wire shape is introduced.

Dashboard presentation lives in `apps/shared/dashboards`, shared by Desktop/Web,
the VS Code webview, and the existing Teams client:

```text
apps/shared/dashboards/
  dashboard-workspace.tsx
  dashboard-workspace.css
  sellerDashboard/
    seller-dashboard.tsx
    seller-dashboard-sections.tsx
    seller-dashboard-table.tsx
    seller-dashboard-analysis.ts
    seller-dashboard.css
  StageAndPipelineReview/
    stage-pipeline-review.tsx          pane: state, header, tabs
    stage-pipeline-filters.tsx         scope toggles, filter bar, multi-select, chips
    stage-pipeline-analysis.ts         pure filter/KPI/alert/ACR/milestone/CSV helpers
    stage-pipeline-opportunities.tsx   alert cards, KPI tiles, opportunity table
    stage-pipeline-acr-chart.tsx       ACR Actuals and Outlook chart
    stage-pipeline-milestones.tsx      milestone status chart, filters, table
    stage-pipeline-extra-tabs.tsx      Actions, Consumption, MACC & Commits
    stage-pipeline-parts.tsx           KPI/pill/row-action/CSV-download primitives
    stage-pipeline-table.tsx           sortable table
    stage-pipeline-storage.ts          browser-only Focus/Reviewed marks
    stage-pipeline-scope.tsx           portfolio scope (mine/reports/both), direct-report picker, source-health notice
    stage-pipeline-writes.ts           comment/milestone edit review, sample-mode write simulation
    stage-pipeline-write-dialog.tsx    reviewed write dialog (forecast comment, milestone update, task)
    stage-pipeline-dispatch.ts         routes reviewed actions to the existing MSX write operations
    stage-pipeline-review.css
  soltionEngineerDashboard/
    se-reporting-dashboard.tsx
    report-setup.tsx
    report-workflow.tsx
    se-reporting-dashboard.css
```

Each dashboard owns its components, helpers, and feature-scoped styles in its own
folder. Future dashboards, such as `SE-manager-dashboard` or `AE-dashboard`, belong
in sibling folders beside `sellerDashboard`. Register their tabs and panes in
`dashboard-workspace.tsx` and import their styles in each consuming surface's entry
point. Seller Dashboard, Stage and Pipeline Review and SE Reporting Dashboard are registered; no placeholder
tabs are shown. The `soltionEngineerDashboard` spelling is intentional for the
requested module path.
Stage and Pipeline Review's browser-safe contract is
`packages/common/contracts/stage-pipeline-review.ts` with a fictitious fixture in
`packages/common/fixtures/stage-pipeline-review.ts`. It runs in sample mode today; the pane
takes an optional `invoke` so a shared orchestrator operation can feed live data later
(see `.github/skills/stage-pipeline-review-dashboard/references/data-mapping.md`).
Its prompts and skill live in `.github/skills/stage-pipeline-review-dashboard/` and
`.github/prompts/generate-stage-pipeline-review.prompt.md`.
Contracts, data access, and orchestration remain in their existing package layers.

SE Reporting uses independently versioned schemas in
`packages/common/contracts/se-reporting.ts`, one synthetic fixture in
`packages/common/fixtures/se-reporting.ts`, the shared generation/review host in
`packages/orchestrator/se-reporting`, and delegated source/configuration adapters
in `packages/connectors/se-reporting`. The browser-safe HTML document renderer in
`packages/documents/se-reporting.ts` is used for both the dashboard preview and
download/publication. See the [SE Reporting Dashboard guide](user-guide/SE-REPORTING-DASHBOARD.md)
for setup, source grants, privacy and publication boundaries.

Seller Dashboard's browser-safe, independently versioned
schemas live in `packages/common/contracts/seller-dashboard.ts`, with one fictitious
snapshot in `packages/common/fixtures/seller-dashboard.ts`. The shared read-only
host in `packages/orchestrator/seller-dashboard.ts` fronts the optional
Windows-encrypted profile adapter in `packages/connectors/common/seller-dashboard.ts`.
Electron IPC, authenticated/no-store HTTP, and the strict webview bridge invoke
the same operations. `createWebSellerDashboardHost` in `apps/web/src/runtime.ts`
denies host-user private profiles in all Web live modes, including local Azure CLI,
until HTTP caller authentication is identity-bound. Desktop/local Windows VS Code
retain the protected-profile adapter; Web sample mode remains synthetic.

Voice search uses shared `voice-input.ts`, `use-voice-dictation.ts`,
`voice-search-control.tsx`, and provider adapters in `apps/shared`. Its strict
contracts live in `packages/common/contracts/voice.ts`; the shared native-session
host is `packages/orchestrator/voice-input.ts`, with local Windows capture in
`packages/connectors/common/windows-voice.ts`. The two focused portfolio-search
components remain thin UI integrations. `scripts/prepare-voice-model.mjs` and
`scripts/voice-worker-assets.mjs` build the offline browser model/isolated worker;
sanitized audio fixtures live in `tests/fixtures/voice-input`. Research and the
implemented design are documented under `docs/research`.

Meeting capture's Desktop/Web launcher and review modal live in the focused
`apps/desktop/renderer-revamp/src/meeting-capture.tsx` (shared by Desktop and Web,
not `apps/shared`, since it depends on the renderer-revamp `RevampDataClient` and
Fluent UI already used throughout `App.tsx`). The VS Code webview keeps its own
equivalent component. The "Teams meeting" dropdown inside both launchers (and in
the Teams client) is the one shared `apps/shared/meeting-picker.tsx`. Both call the same shared connectors/extractor
(`packages/connectors/msx/live-meeting.ts`, `packages/connectors/local-store`,
`packages/agents/meeting-signal-extractor`) through host-specific transports:
Electron IPC (`apps/desktop/electron/main/index.ts`), the webview bridge
(`apps/vscode-extension/src/host-router.ts`), and Web HTTP routes
(`apps/web/src/app.ts`/`runtime.ts`/`server.ts`).

Opportunity/Milestone creation uses the browser-safe `apps/shared/record-creation/`
workspace, forms, grid, CSV helpers, and preview across all three surfaces.
`packages/common/contracts/record-creation.ts` defines its strict wire shapes;
`packages/orchestrator/record-creation/` owns catalog validation, signed review,
policy, and draft export. The SQLite schema, migration, catalog, atomic writer,
and receipts live in `packages/connectors/local-store/`. `packages/connectors/msx/live.ts`
exposes read-only creation catalog queries, not a live writer. Electron IPC, Web
HTTP, and the VS Code bridge marshal these same orchestrator operations.

```text
Renderer UI
    |
    v
Electron preload and validated IPC
    |
    v
Orchestrator
    |
    +--> Agents
    |      |
    |      `--> Connector interfaces or supplied evidence
    |
    `--> Trusted connector implementations
               |
               `--> Authorized enterprise sources
```

The following dependency rules apply:

1. UI modules may depend on common presentation contracts but not agents or connector implementations.
2. Agents may depend on common contracts and connector interfaces but not the desktop application.
3. Agents must not call other agents directly; cross-agent workflows belong in the orchestrator.
4. Connector implementations may depend on common contracts but not agents or UI modules.
5. Common must not depend on orchestrator, agents, connectors, or desktop modules.
6. Access tokens must stay in the trusted Electron main process or another explicitly trusted boundary.

## Test Structure

The test tree mirrors the production tree so ownership is immediately visible:

- `unit` verifies isolated logic within each module.
- `integration` verifies communication between approved module boundaries.
- `contract` verifies versioned agent, connector, orchestrator, and IPC handoffs.
- `e2e` verifies complete Electron user journeys.
- `evaluation` holds golden scenarios, expected properties, and agent scoring rubrics.
- `security` verifies token isolation, IPC validation, navigation allowlists, and secret-safe logging.
- `fixtures` stores deterministic, sanitized source responses grouped by connector.

Tests that require live enterprise access should be explicitly tagged and excluded from the default local test run. Unit, contract, and most integration tests should use deterministic fixtures.

## Naming and Ownership Conventions

- Use lowercase kebab-case for directories.
- Give every package a single public entry point.
- Keep module-internal files private unless exported through that entry point.
- Add a short README to each agent and connector when implementation begins, documenting purpose, inputs, outputs, dependencies, failure behavior, and owner.
- Keep contracts backward compatible within a version; introduce a new version for breaking changes.
- Do not create a generic `utils` dumping ground. Shared utilities must have a specific responsibility and a clear owning folder.

## Scaffolding Gate

Implementation folders should be created only after approval of the PRD decisions covering the MVP surface, authentication model, four-agent capability map, source access, and acceptance criteria.
