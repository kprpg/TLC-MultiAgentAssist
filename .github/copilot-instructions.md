# Copilot / Contributor Instructions — TLC MultiAgentAssist

These are the durable engineering rules for this repository. They apply to **every major check-in**
(anything that touches the backend, the orchestrator/harness, a host transport, a shared contract, or
a UI layer). They exist to keep one stable backend, one stable orchestrator/harness, and cleanly
separated UI layers.

The full rationale, evidence, and the implementable backlog live in
[`docs/engineering/Code-Refactoring-Optimization-Tests.md`](../docs/engineering/Code-Refactoring-Optimization-Tests.md).
When a rule and that doc disagree, the doc's detailed item wins — update this file to match.

> Scope note: these are capture/guardrail rules, not a mandate to refactor. Make the **smallest change
> that satisfies the request** and obeys the boundaries below. Do not opportunistically rewrite stable
> code.

## Architecture you must preserve

```
packages/common         → shared contracts, schemas, types (Zod, versioned)
packages/connectors     → MSX / Dataverse / MCP data access
packages/agents         → agent logic + Foundry prompts/manifests/golden-scenarios
packages/orchestrator   → ThinSliceOrchestrator + SharedWorkflowHost/WorkflowHost  (STABLE CORE)
        ▲
        │  one-way dependency: hosts/UI depend on the core, never the reverse
        │
apps/desktop            Electron main (composition) + renderer/renderer-revamp (UI)
apps/web                HTTP host (composition) + browser client (UI)
apps/vscode-extension   extension host (composition) + webview (UI)
apps/shared             genuinely cross-UI code only (e.g. discovery)
[Teams]                 not yet present — stub only (see Rule 7)
```

### Rule 1 — The backend is stable and lives behind versioned contracts
- Treat `packages/common`, `packages/connectors`, and `packages/agents` as a stable backend.
- All cross-layer data crosses a **Zod contract** in `packages/common`. Changing a contract shape is a
  breaking change: bump the relevant version field (`contractVersion`, `workflowContractVersion`) and
  update the contract tests (`tests/contract/*`).
- Keep agent manifest `definition.instructions` byte-for-byte equal (after trim) to the agent's
  `prompts/instructions.md`. Keep `golden-scenarios.json` in sync with agent behavior.
- No UI or host may import connector/agent internals directly — go through the orchestrator and
  contracts.

### Rule 2 — The orchestrator/harness is the single middle layer
- `ThinSliceOrchestrator` (`packages/orchestrator/index.ts`) and
  `SharedWorkflowHost`/`WorkflowHost` (`packages/orchestrator/workflows/host.ts`) are the one harness
  shared by **all** hosts. Do not fork per-UI orchestrators or re-implement orchestration in a host.
- Every capability a UI needs must be an orchestrator **operation**, invoked identically over all three
  transports (Electron IPC, HTTP, webview bridge). Transports marshal; they must not contain business
  logic.
- When you add/change an operation, it must behave identically on all transports and be covered by the
  transport-parity tests (`tests/unit/hosts/*`). See
  [MOD-2](../docs/engineering/01-modularization.md) / [TEST-3](../docs/engineering/04-testing-strategy.md).

### Rule 3 — Dependencies flow one way
- Allowed: `apps/*` → `packages/orchestrator` → `packages/{common,connectors,agents}`.
- Forbidden: core depending on an app; one app depending on another app's internals (e.g. web importing
  `apps/desktop/...`). If two UIs need the same code, lift it into `packages/*` or `apps/shared`, don't
  cross-import. See [MOD-5](../docs/engineering/01-modularization.md).

### Rule 4 — UI layers are isolated and interchangeable
- Keep Desktop, VS Code webview, and Web as thin view layers. Shared presentation/logic (view-model
  mapping, markdown rendering, prompt catalog, sort/sample helpers) belongs in a **browser-safe**
  shared module, not copied per UI. Do not add a fourth copy of logic that already exists elsewhere.
- The VS Code webview cannot import Node-backed `packages/common`; shared UI code it consumes must be
  browser-safe (no Node built-ins). See the renderer-import memory and
  [MOD-3/MOD-4](../docs/engineering/01-modularization.md).
- Don't grow the mega-components. `App.tsx` in desktop-revamp and the VS Code webview are already
  oversized; new UI work should land as focused components/hooks, not more `useState` in `App.tsx`.
  See [UI-1](../docs/engineering/02-ui-layout.md).

### Rule 5 — One composition root per host
- Connector/agent/workflow-host wiring is assembled once per host (desktop main, web runtime, vscode
  provider). Don't duplicate the capability list
  (`account-pulse`, `mcem-coach`, `pursuit-executive`, `risk-solution-play`) or re-hand-wire assembly
  inline. Prefer the shared factory path. See [MOD-1](../docs/engineering/01-modularization.md).

### Rule 6 — Tests mirror the layer you touched
Before a major check-in, add/extend tests for the layer(s) you changed:
- **Backend** (common/connectors/agents): unit + contract tests; deterministic fixtures, no live
  network in the default suite (live tests stay opt-in behind `TLC_RUN_LIVE_SMOKE`).
- **Orchestrator/harness**: operation unit tests + transport-parity + lifecycle tests.
- **Functional e2e**: a journey assertion on the affected surface(s).
- **UI**: static render at minimum; interaction tests for new interactive components.
- Agent behavior changes must update/execute the relevant `golden-scenarios.json`.
See [`04-testing-strategy.md`](../docs/engineering/04-testing-strategy.md) for the full taxonomy and
the currently-missing types (security, a11y, performance, golden-scenario evaluation).

### Rule 7 — Teams stays a stub until explicitly built
Teams is not implemented. Any Teams work is a **stub behind the same orchestrator contracts** — no
business logic in a Teams layer, no new backend coupling. See
[MOD-6](../docs/engineering/01-modularization.md).

### Rule 8 — Security and privacy are non-negotiable
- Preserve the trust boundaries: Electron `assertTrustedSender`, web same-origin + Easy-Auth checks,
  the Dataverse `query-guard` allowlists, MCP default-deny + approval gates + field redaction, and
  HTTPS-only evidence links.
- Never log prompt text, customer names/ids, or tokens in telemetry. Never commit secrets; reference
  `config/*.default.json` / `.example.json`, never a real `config/foundry.environment.json`.
- Run secret scanning on changed files before committing.

## Required checks before a major check-in
Run and keep green:
- `npm run phase0:check` — structure + preflight + lint + typecheck + unit/contract tests.
- `npm run validate:major` — typecheck + tests + desktop smoke (for host/UI/orchestrator changes).
- For UI/e2e-affecting changes also run the relevant smoke:
  `npm run test:smoke:revamp` (desktop + webview) and/or `npm run test:smoke:desktop`.
- CI runs on push to `master` via `.github/workflows/ci.yml` (`phase0:check` + `npm test -- --coverage`).
  CI does **not** yet run Playwright e2e or enforce coverage thresholds, so run the smokes locally. See
  [TEST-9](../docs/engineering/04-testing-strategy.md).

## Definition of done for a major change
1. Smallest change that fully satisfies the request; no unrelated edits.
2. Boundaries respected (Rules 1–5, 8); no new cross-app or UI→connector imports.
3. Contracts versioned if shapes changed; manifests/golden-scenarios in sync.
4. Tests added for every layer touched (Rule 6); `validate:major` green.
5. No secrets, no prompt/customer/token logging; security boundaries intact.
6. Docs updated when behavior/structure changed (incl. `docs/Folder-structure.md` if layout changed).
