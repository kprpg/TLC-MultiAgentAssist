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
