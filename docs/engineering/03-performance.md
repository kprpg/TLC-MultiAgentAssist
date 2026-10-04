# 03 — Performance Improvements

> Capture only. Part of [Code / Refactoring / Optimization / Tests](Code-Refactoring-Optimization-Tests.md).
> Builds on the prior pass in [`docs/performance/performance-optimization.md`](../performance/performance-optimization.md).

## 1. What the prior pass already did (baseline)

The existing performance work (see the perf doc) made conservative, correct choices that should be
preserved:

- **Startup no longer blocks on a discarded Foundry call.** The automatic MCEM diagnostic is built
  from cached MSX context + local MCEM guidance + deterministic local evaluation; explicit agent
  actions remain Foundry-backed.
- **One shared Foundry client** is reused across the four agents (one `AIProjectClient` →
  one OpenAI client), created via `createFoundryOpenAIClient` and passed into each `FoundryPromptAgent`
  (`apps/desktop/electron/main/index.ts:104-131`, `apps/web/src/runtime.ts:31-48`).
- **Process-level caches** exist: MSX portfolio hydration memoized, MCEM PDF parse/validate memoized,
  Azure CLI MSX token cached until ~5 minutes before expiry.
- **Phase-level timing** is emitted via `measurePerformance` (`packages/common/telemetry/performance.ts`)
  and the orchestrator wraps `agent.context.msx`, `agent.context.mcem`, and
  `agent.invoke.<capability>` (`packages/orchestrator/index.ts:185-198`). The reporter is
  fire-and-forget and never interrupts the measured operation.

The items below extend this without undoing those wins.

## 2. Highest-leverage issues found

| Area | Issue | Item |
| --- | --- | --- |
| Backend cache | MSX portfolio cache has **no TTL/invalidation** → stale data risk, or needless reloads | PERF-1 |
| Web host | Orchestrator is rebuilt **per request** (new `LiveMsxConnector` each call) | PERF-2 |
| Web host | Host-cache eviction `dispose()` has **no timeout/logging** → possible resource leak | PERF-3 |
| Measurement | No **before/after latency benchmark** captured yet (perf doc defers it) | PERF-4 |
| UI | Desktop renderer **over-renders**; bundle not code-split | PERF-5 |
| Telemetry | Performance events are **fire-and-forget only** (no aggregation) | PERF-6 |

---

## PERF-1 — TTL + explicit invalidation for the MSX portfolio cache · P0

**Problem / evidence.** `LiveMsxConnector` memoizes portfolio hydration for the whole session
(`packages/connectors/msx/live.ts`; portfolio promise memoized with no expiry), plus per-opportunity
observation/milestone memoization. There is no TTL and no documented invalidation on mutation, so a
long-lived session can serve stale accounts/opportunities after changes made elsewhere, while the web
host (which keeps per-user hosts for a long time) is most exposed.

**Proposed change.** Give the portfolio cache a bounded lifetime and explicit invalidation:

- Store `{ value/promise, expiresAt }` and refetch when expired (e.g. a few minutes TTL, tunable).
- Invalidate the portfolio entry on the mutations that change it (add account, set visibility,
  join/leave deal team) so the next read reflects the change immediately.
- Keep per-opportunity evidence lazy and keyed by opportunity id (already the case).

**Acceptance criteria.**
- After a mutation, the next portfolio read reflects it without a full process restart.
- Stale reads are bounded by the TTL; no unbounded session-length caching.
- New unit tests cover "mutate → cache invalidated → reload shows change" and TTL expiry
  (pairs with [TEST-2](04-testing-strategy.md#test-2--backend-unit-tests-agents--msx-connector--p0)).

**Blast radius.** Medium. Core connector behavior; cover with deterministic fixture tests.

---

## PERF-2 — Cache the per-user orchestrator in the web host · P1

**Problem / evidence.** `apps/web/src/runtime.ts:56-59` returns a factory that builds a **new**
`LiveMsxConnector` and `ThinSliceOrchestrator` on **every** authenticated request. The workflow host
is already cached per user with eviction (`createHostedWorkflowHostResolver`, `:62-107`), but the
orchestrator/runtime path is not, so every data call re-allocates connector state and discards any
warm cache.

**Proposed change.** Cache the orchestrator (and its MSX connector) per `clientPrincipal`, mirroring
the existing workflow-host cache: reuse on subsequent requests, update the token in place, and evict
with disposal. This also makes PERF-1's cache meaningful across requests for the same user.

**Acceptance criteria.**
- Repeated requests from the same principal reuse one orchestrator/connector instance.
- Token refresh still works (token updated in place, as the workflow-host cache already does).
- Eviction disposes cached orchestrators; memory stays bounded under many users.

**Blast radius.** Medium. Web host state/lifecycle; cover with `tests/unit/hosts/*` additions.

---

## PERF-3 — Harden web host-cache eviction and disposal · P1

**Problem / evidence.** `evictOldestWorkflowHost` (`apps/web/src/runtime.ts:109-118`) deletes the
LRU entry and awaits `dispose()` with no timeout and no logging. If `dispose()` (which closes the MCP
client pool) hangs or rejects, the eviction path can stall or silently leak pool resources.

**Proposed change.** Make disposal defensive: remove the entry first, then `await` disposal under a
bounded timeout, and log failures (without leaking tokens/PII). Apply the same pattern to the
orchestrator cache from PERF-2 and to VS Code provider swaps (`extension.ts` swap → `previous.dispose()`).

**Acceptance criteria.**
- A slow/failing `dispose()` cannot block new requests; failures are logged with a correlation id.
- No pool handle leak under repeated eviction (verified by a unit test with a fake pool).

**Blast radius.** Low-medium. Localized to eviction/disposal helpers.

---

## PERF-4 — Capture the deferred before/after latency benchmark · P1

**Problem / evidence.** The perf doc explicitly states no controlled before/after live benchmark has
been captured, so no latency-reduction percentage is claimed, and warns against using the packaged
smoke duration as a proxy. The phase metrics exist (`msx.*`, `agent.context.*`, `agent.invoke.*`) but
are not collected into a repeatable benchmark.

**Proposed change.** Implement the benchmark procedure already documented in the perf doc as a
repeatable, opt-in script/test: fixed identity/network/portfolio/prompt, ≥1 cold + 5 warm runs,
record each MSX phase and each agent phase, and report median and p95 for cold vs warm. Store a
baseline so regressions are visible. Keep it out of the default unit run (live/opt-in), consistent
with the existing `TLC_RUN_LIVE_SMOKE` convention.

**Acceptance criteria.**
- A documented command produces median/p95 per phase for cold and warm runs.
- A committed baseline exists; the perf doc's "Results" section can state measured deltas.
- Pairs with [TEST-8](04-testing-strategy.md#test-8--performancebenchmark-tests-with-baselines--p2).

**Blast radius.** Low. Additive measurement; no production code path change.

---

## PERF-5 — Reduce UI bundle and render cost · P2

**Problem / evidence.** The desktop `App` re-renders broadly (79 `useState`, few memo boundaries;
see [UI-3](02-ui-layout.md#ui-3--scoped-ui-state-to-stop-prop-drilling-and-over-render--p1)), long
lists mount fully (see [UI-6](02-ui-layout.md#ui-6--virtualize-long-lists-and-tables--p2)), and the
revamp bundle is shipped as-is to both desktop and web.

**Proposed change.** After UI-1/UI-3 land, add `React.memo`/selector boundaries on feature
components, lazy-load heavy/rarely-used views (e.g. Discover, dialogs) via code-splitting, and
virtualize long lists. Measure render counts and bundle size before/after.

**Acceptance criteria.**
- Interacting with one area does not re-render unrelated areas (render-count check).
- Initial bundle shrinks via lazy routes; no functional regression in desktop/web e2e.

**Blast radius.** Medium. Depends on the UI decomposition items.

---

## PERF-6 — Persist/aggregate performance telemetry · P2

**Problem / evidence.** `measurePerformance` emits one structured log line per phase and is
fire-and-forget (`packages/common/telemetry/performance.ts`); nothing aggregates or retains it, so
trends and regressions are invisible between runs. (The repo already carries an
`appinsights-instrumentation` skill under `.github/skills/`, indicating App Insights is an accepted
direction.)

**Proposed change.** Add an optional telemetry sink that aggregates phase durations (count,
median, p95) per operation and can export them (file and/or App Insights), keeping the existing
log reporter as the default and preserving the "no prompt text, names, ids, tokens, or token counts"
rule. Make the sink host-configurable and off by default for sample mode.

**Acceptance criteria.**
- Phase metrics can be aggregated and exported without logging sensitive content.
- Default behavior (log-only, fire-and-forget) is unchanged when the sink is not configured.

**Blast radius.** Low-medium. Additive; guard the privacy invariant with a test.

---

## Sequencing

```
PERF-1 (cache TTL) ──► PERF-2 (per-user orchestrator) ──► PERF-3 (safe eviction)
PERF-4 (benchmark) underpins PERF-1/2/5 (measure before claiming wins)
UI-1/UI-3 ──► PERF-5 (render/bundle)    PERF-6 (telemetry) is independent
```

Measure first (PERF-4), then PERF-1 → PERF-2 → PERF-3 for the biggest, lowest-risk wins.
