# 04 — Testing Strategy

> Capture only. Part of [Code / Refactoring / Optimization / Tests](Code-Refactoring-Optimization-Tests.md).
> Covers the test categories requested — backend, middle-layer (orchestrator/harness), functional
> e2e, and UI (VS Code "shell" extension, desktop, web) — plus the test types currently missing.

## 1. Current test setup (as-is)

- **Runners:** Vitest (`vitest.config.ts`, Node environment, `tests/**/*.{test,spec}.ts`, excludes
  `tests/e2e/**`) for unit/integration/contract; Playwright (`playwright.revamp.config.ts`,
  `tests/e2e/revamp/*`) and desktop Electron smoke (`tests/e2e/desktop/*`); and the VS Code extension
  test CLI (`apps/vscode-extension/.vscode-test.mjs` → `apps/vscode-extension/test/extension.test.cjs`,
  Mocha).
- **CI:** `.github/workflows/ci.yml` triggers on push to `master` + `workflow_dispatch` (no
  `pull_request`), runs `npm run phase0:check` (structure + preflight + lint + typecheck + test) then
  coverage, and uploads the coverage artifact (30-day retention). **Playwright e2e/smoke is not run in
  CI**, and **no coverage thresholds are enforced** (`vitest.config.ts` sets reporters only).
- **Local gates:** `npm run validate:major` (typecheck + test + desktop smoke) and `npm run
  phase0:check`.
- **DOM:** tests run in the Node environment; there is **no jsdom/happy-dom/@testing-library**. React
  components are asserted via `renderToStaticMarkup` (e.g.
  `tests/unit/vscode-extension/app-header.test.ts`), i.e. static HTML only — no interaction/event
  testing.

## 2. Coverage map (what exists vs what is missing)

Legend: ✅ solid · 🟡 partial · ❌ missing/empty.

| Layer | Unit | Integration | Contract | e2e / functional | UI render | a11y | perf | security |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Backend — common | ✅ `tests/unit/common/*` | — | ✅ `tests/contract/*` | — | — | — | ❌ | ❌ |
| Backend — connectors | 🟡 `tests/unit/connectors/*` + `tests/connectors/*` | 🟡 `tests/integration/mcp-http-client` | ✅ | live-only (opt-in) | — | — | ❌ | ❌ |
| Backend — agents | ❌ `tests/unit/agents/` empty | ❌ `tests/integration/agents/` empty | 🟡 mcem-contract | — | — | — | ❌ | ❌ |
| Orchestrator / harness | ✅ `tests/unit/orchestrator/*` | ✅ `tests/integration/orchestrator/mcem-thin-slice` | ✅ `workflow-contract` | — | — | — | ❌ | ❌ |
| Hosts (transport) | 🟡 `tests/unit/hosts/*` (workflow parity only) | ❌ `tests/integration/desktop/` empty | 🟡 `vscode-extension-bridge` | — | — | — | — | ❌ |
| Desktop UI | 🟡 `tests/unit/desktop/*` (logic) + `tests/electron/*` | ❌ | — | ✅ `tests/e2e/desktop/*`, `tests/e2e/revamp/desktop*` | 🟡 static only | ❌ | ❌ | ❌ |
| VS Code UI (shell) | ✅ `tests/unit/vscode-extension/*` (17, static render) + `extension.test.cjs` | ❌ | ✅ bridge contract | ❌ no webview e2e | 🟡 static only | ❌ | ❌ | ❌ |
| Web UI | 🟡 `tests/unit/web/*` (server) | — | — | ✅ `tests/e2e/revamp/web.spec.ts` (+ visual snapshots) | — | ❌ | ❌ | ❌ |
| Teams | n/a (absent) | — | — | — | — | — | — | — |

**Empty/declared-but-unused directories:** `tests/security/`, `tests/evaluation/`,
`tests/unit/agents/`, `tests/integration/agents/`, `tests/integration/connectors/` (real connector
tests live in `tests/connectors/`), `tests/integration/desktop/`, and most `tests/fixtures/*`.

**Golden scenarios exist but are not executed behaviorally.** Each agent ships
`packages/agents/*/golden-scenarios.json` (prompt + `expected[]` behaviors), but the only consumer is
`tests/unit/common/foundry-agent-manifests.test.ts`, which merely parses the JSON and checks the
`agent` field matches the manifest — it never runs a scenario or asserts the expected behaviors.

**Visual regression exists but is manual.** `tests/e2e/revamp/web.spec.ts` carries committed PNG
snapshots (`web.spec.ts-snapshots/*`); there is no automated pixel-diff gate in CI.

---

## TEST-1 — Behavioral golden-scenario evaluation harness · P0

**Problem / evidence.** `tests/evaluation/` is empty; the four `golden-scenarios.json` files are
schema-validated only. Agent behavior (ranking only with evidence, labeling stale/partial sources,
not inventing signals) is therefore unenforced.

**Proposed change.** Add an evaluation harness under `tests/evaluation/` that, for each agent, loads
its `golden-scenarios.json`, runs the scenario against the agent (deterministic/stub mode by default;
live Foundry opt-in like `TLC_RUN_LIVE_SMOKE`), and asserts the `expected[]` behaviors via explicit
rubric checks. Start with `mcem-coach` (it has local `evaluateMcemProgress` logic, so it is fully
deterministic) and the sample/deterministic providers for the other three.

**Acceptance criteria.**
- Each golden scenario runs and asserts its expected behaviors; failures are actionable.
- The deterministic subset runs in the default `npm test`; the live subset is opt-in.
- Adding a scenario to a JSON file automatically adds a test case.

**Blast radius.** Low (additive tests). High value — closes the agent-behavior gap.

---

## TEST-2 — Backend unit tests: agents + MSX connector · P0

**Problem / evidence.** `tests/unit/agents/` and `tests/integration/agents/` are empty. The MSX live
connector (`packages/connectors/msx/live.ts`, **928 lines** — caching, 40-item batch chunking,
write-metadata, error mapping) has only indirect/live coverage.

**Proposed change.**
- Agents: unit-test `mcem-coach`'s `evaluateMcemProgress` across all stage transitions (met/unmet
  criteria, advance/override/recycle dispositions) using fixtures. For the Foundry-prompt agents,
  test the deterministic/sample response builders and the prompt/catalog mapping.
- MSX connector: fixture-driven tests for portfolio caching + invalidation (pairs with
  [PERF-1](03-performance.md#perf-1--ttl--explicit-invalidation-for-the-msx-portfolio-cache--p0)),
  batch chunking at the 40-item boundary, account-GUID validation, and HTTP error → `MsxRequestError`
  mapping. Keep real-endpoint tests in the existing opt-in `tests/connectors/msx-live.test.ts`.

**Acceptance criteria.**
- `tests/unit/agents/` contains real coverage for all four agents' local/deterministic paths.
- MSX caching/paging/error paths are covered with deterministic fixtures (no network).

**Blast radius.** Low (additive). May reveal real bugs in caching/paging — expected.

---

## TEST-3 — Orchestrator/harness: full transport parity + host lifecycle · P0

**Problem / evidence.** `tests/unit/hosts/workflow-transport-parity.test.ts` asserts parity for
**workflow** operations only. The ~14 orchestrator operations exposed over three transports
(Electron IPC, HTTP, webview bridge) can drift for non-workflow operations. `tests/integration/desktop/`
is empty, and host lifecycle (web per-user host cache eviction/disposal, VS Code provider swap) is
only partially covered (`tests/unit/hosts/web-workflow-host-cache.test.ts`).

**Proposed change.**
- Extend transport-parity tests to **every** operation in the registry (ties to
  [MOD-2](01-modularization.md#mod-2--single-operation-registry-driving-all-three-transports--p0)):
  the same input yields the same validated output across IPC, HTTP, and bridge.
- Add host-lifecycle tests: web host/orchestrator eviction disposes resources under timeout
  (pairs with [PERF-3](03-performance.md#perf-3--harden-web-host-cache-eviction-and-disposal--p1)),
  cancellation aborts in-flight workflow steps, and VS Code provider swap disposes the previous
  provider.

**Acceptance criteria.**
- Parity is enforced for all operations, not just workflows.
- Eviction/cancellation/disposal paths are covered with fakes (no live sources).

**Blast radius.** Low (tests), but becomes the safety net for MOD-1/MOD-2.

---

## TEST-4 — Functional e2e coverage (incl. web-live smoke) · P1

**Problem / evidence.** Desktop has a live smoke (`tests/e2e/desktop/live.spec.ts`, gated by
`TLC_RUN_LIVE_SMOKE`), but the **web** surface has no live integration smoke — only the sample-data
revamp specs (`tests/e2e/revamp/web.spec.ts`, `discovery.spec.ts`, `desktop-milestones.spec.ts`).
Core journeys (account curation, discovery, milestone edit, stage transition, run a play, agent task,
export/email) are not all exercised end-to-end on every surface.

**Proposed change.** Add a web-live smoke paralleling the desktop one (opt-in env flag, real
MSX/Dataverse/Foundry) and fill functional gaps in the sample-mode revamp suite so each primary
journey has at least one e2e assertion on desktop and web. Note the existing open item in
`docs/TODO.md` about the desktop e2e email-dialog flow — track its fix here.

**Acceptance criteria.**
- A documented `test:smoke:web:live` (or equivalent) runs the web surface against live sources.
- Each primary journey has an e2e test on desktop and web; the email-dialog e2e is fixed or tracked.

**Blast radius.** Low (additive e2e). Live subset stays opt-in.

---

## TEST-5 — UI component/interaction tests (DOM environment) · P1

**Problem / evidence.** UI unit tests assert **static** markup via `renderToStaticMarkup` only; there
is no DOM environment, so click/keyboard/focus behavior is untested at the component level. This gap
grows as UI-1 decomposes the mega-components.

**Proposed change.** Add a DOM-capable test project (e.g. a jsdom/happy-dom Vitest project or
`@testing-library`) scoped to UI packages, and write interaction tests for the components extracted in
[UI-1](02-ui-layout.md#ui-1--decompose-the-app-mega-components--p0) (blade resize, tab switching,
dialog open/submit/cancel, plays queue selection) across desktop and the VS Code webview. Keep the
Node-env suite for pure logic; run the DOM suite as a separate Vitest project so the default
environment stays `node`.

**Acceptance criteria.**
- Key interactive components have event/focus tests, not just static-markup snapshots.
- The DOM suite is isolated from the Node suite; both run in `npm test`.

**Blast radius.** Low-medium (new test tooling). Introduce alongside UI-1 to lock behavior.

---

## TEST-6 — Security test suite · P0

**Problem / evidence.** `tests/security/` is empty despite several security-critical surfaces:
Electron IPC trust (`assertTrustedSender`, `apps/desktop/electron/main/index.ts:195-200`), web
same-origin + Easy-Auth checks (`apps/web/src/app.ts:270-286`), the Dataverse query guard
(`packages/connectors/dataverse-mcp/query-guard.ts` — entity/field/scope allowlists), MCP tool policy
(`default-deny`, approval gates, `redactFields`), HTTPS-only evidence links, and the privacy
invariant that telemetry logs no prompt text/names/ids/tokens.

**Proposed change.** Add `tests/security/` covering, at minimum:
- IPC rejects untrusted senders; web rejects cross-origin mutations and missing Easy-Auth headers.
- Query guard denies non-allowlisted entities/fields/relationship expansion and enforces delegated
  scope; MCP policy enforces default-deny, approval gates, and field redaction.
- Evidence open rejects non-HTTPS URLs; filename sanitization strips unsafe characters.
- Telemetry/log output contains no tokens, prompt text, customer names, or ids (redaction test).
- Input-injection resistance for Dataverse query construction and markdown rendering.

**Acceptance criteria.**
- Each boundary above has an explicit allow/deny test; regressions fail CI.
- The telemetry redaction invariant is asserted.

**Blast radius.** Low (additive). High value; wire into CI with the rest.

---

## TEST-7 — Accessibility tests (axe) · P1

**Problem / evidence.** No automated a11y checks exist; `aria`/`role` usage is partial
(see [UI-5](02-ui-layout.md#ui-5--accessibility-pass--p1)).

**Proposed change.** Add axe-based scans to the Playwright revamp suite for the main desktop and web
views and key states (dialog open, drawer open), failing on serious/critical violations. Add keyboard
navigation assertions for the highest-risk widgets (blade resize, tab list, dialog focus trap).

**Acceptance criteria.**
- axe scans run in the e2e suite and gate on serious/critical issues.
- Keyboard-operability is asserted for the primary interactive widgets.

**Blast radius.** Low (additive). Pairs with UI-5.

---

## TEST-8 — Performance/benchmark tests with baselines · P2

**Problem / evidence.** The only perf test is `tests/unit/common/performance.test.ts` (it tests the
`measurePerformance` wrapper, not real latency). No phase benchmark or regression baseline exists
(see [PERF-4](03-performance.md#perf-4--capture-the-deferred-beforeafter-latency-benchmark--p1)).

**Proposed change.** Implement the perf-doc benchmark procedure as a repeatable, opt-in benchmark
(MSX phases + agent phases, cold vs warm, median/p95) with a committed baseline, so regressions are
detectable. Optionally add micro-benchmarks for hot connector paths (batch chunking, query guard).

**Acceptance criteria.**
- A documented benchmark command emits per-phase median/p95 and compares to a stored baseline.
- Running it requires no code change to production paths.

**Blast radius.** Low (opt-in). Depends on PERF-4's measurement plumbing.

---

## TEST-9 — Coverage thresholds + run e2e/smoke in CI · P1

**Problem / evidence.** `vitest.config.ts` sets reporters but **no thresholds**; `ci.yml` runs
`phase0:check` + coverage but **never runs Playwright e2e/smoke**, so UI/functional regressions are
not caught in CI, and coverage can silently fall.

**Proposed change.** Add coverage thresholds in `vitest.config.ts` (start at the current level to
avoid churn, then ratchet up) scoped sensibly (measure `packages/*` and host logic; exclude generated
output). Add a CI job (or stage) that runs the revamp Playwright smoke and the desktop smoke on the
appropriate runner, uploading traces on failure. Consider adding a `pull_request` trigger so checks
run before merge, not only after push to `master`.

**Acceptance criteria.**
- CI fails if coverage drops below the agreed thresholds.
- CI runs the e2e/smoke suites and publishes failure traces.

**Blast radius.** Low-medium (CI config). May require stabilizing flaky specs first (add Playwright
retries).

---

## TEST-10 — Fill/clean declared-but-empty test dirs; align the structure gate · P2

**Problem / evidence.** Several directories are required by `scripts/check-structure.mjs` but hold
only `.gitkeep` (`tests/security`, `tests/evaluation`, `tests/unit/agents`, `tests/integration/agents`,
`tests/integration/connectors`, `tests/integration/desktop`), and real connector integration tests
live in `tests/connectors/` rather than `tests/integration/connectors/`. This makes the test tree
misleading about what is actually covered.

**Proposed change.** As TEST-1/2/3/6 land, populate the relevant directories, and either consolidate
`tests/connectors/` into `tests/integration/connectors/` or update the structure gate and
`docs/Folder-structure.md` to describe the real layout. Keep the test tree mirroring the production
layout as the folder-structure doc intends.

**Acceptance criteria.**
- No required test directory is a `.gitkeep`-only placeholder once its feature area is covered.
- The structure gate and folder-structure doc match the actual test layout.

**Blast radius.** Low. Housekeeping; do it alongside the substantive test items.

---

## Test types checklist (including the ones previously missing)

| Type | Status today | Target item |
| --- | --- | --- |
| Unit (logic) | ✅ broad | maintain |
| Integration (module boundaries) | 🟡 orchestrator only | TEST-2, TEST-3 |
| Contract (schema/handoff) | ✅ | maintain; extend with MOD-2 |
| Functional e2e (desktop/web) | 🟡 sample only | TEST-4 |
| UI render (static) | 🟡 | keep |
| **UI interaction (DOM events)** | ❌ | TEST-5 |
| **Agent evaluation (golden)** | ❌ | TEST-1 |
| **Security** | ❌ | TEST-6 |
| **Accessibility (axe/keyboard)** | ❌ | TEST-7 |
| **Performance/benchmark** | ❌ | TEST-8 |
| Visual regression | 🟡 manual snapshots | automate under TEST-9 |
| Live smoke (opt-in) | 🟡 desktop only | TEST-4 (web) |
| Coverage thresholds / e2e-in-CI | ❌ | TEST-9 |
| Load / stress | ❌ | future (web multi-user; note the 100-host cap) |
| Mutation testing | ❌ | future (orchestrator/connectors) |

Recommended order: TEST-1, TEST-2, TEST-3, TEST-6 (P0 — close behavior/security/parity gaps), then
TEST-4, TEST-5, TEST-7, TEST-9 (P1 — functional/UI/a11y/CI), then TEST-8, TEST-10 (P2).
