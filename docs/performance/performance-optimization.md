# Performance Optimization

> Agent latency (streaming, instant draft, first-token timeout, MSX read concurrency) is covered in [Agentic-Performance.md](./Agentic-Performance.md).

## Summary

This pass addressed two reported latency areas: initial MSX population and explicit Microsoft Foundry workflows. It used a conservative approach that removes avoidable work, reuses existing clients, and adds phase-level measurements without changing the user-facing workflow.

## Changes

### Local startup diagnostic

The automatic MCEM diagnostic no longer invokes Foundry. It now builds the diagnostic from the cached MSX context, local MCEM guidance, and deterministic local evaluation.

Previously, startup waited for a Foundry model response even though that response was discarded. Explicit Account Pulse, MCEM Coach, Pursuit and Executive, and Risk and Solution Play actions remain Foundry-backed.

### Shared Foundry client

The four workflow agents now reuse one authenticated OpenAI client created from one `AIProjectClient`. This avoids creating a separate project/client pipeline for every agent binding and preserves reuse of the existing Foundry credential.

### Source caches

Source reuse is split between private browsing sessions and authoritative operations:

- UI Portfolio/Discovery hydration is cached in a private, bounded memory owner.
  Visible stale datasets revalidate; critical agent/workflow reads and write proofs
  use fresh request-scoped MSX context rather than a process-lifetime browsing snapshot.
- Local MCEM PDF parsing and validation are memoized.
- The Azure CLI MSX token is cached until five minutes before expiration.

## Measurements

Operations use `performance.now()` and emit elapsed time in milliseconds plus a success or failure outcome. The Electron main process writes structured logs in this form:

```text
[performance] {"operation":"agent.invoke.mcem-coach","durationMs":2345.6,"outcome":"success"}
```

No prompt text, response content, customer names, identifiers, access tokens, or token counts are logged.

### MSX phases

| Operation                  | Measurement                             |
| -------------------------- | --------------------------------------- |
| `msx.identity`             | MSX `WhoAmI` request                    |
| `msx.deal-team`            | Active deal-team retrieval              |
| `msx.opportunities`        | Opportunity retrieval                   |
| `msx.accounts`             | Parent-account retrieval                |
| `msx.opportunity-evidence` | Selected opportunity milestone evidence |

### Agent phases

| Operation                   | Measurement                                  |
| --------------------------- | -------------------------------------------- |
| `agent.context.msx`         | Selected opportunity context retrieval       |
| `agent.context.milestones`  | Selected opportunity milestone retrieval     |
| `agent.context.mcem`        | Local MCEM guidance retrieval                |
| `agent.invoke.<capability>` | Foundry invocation for the selected workflow |
| `agent.task.<capability>`   | Complete agent request, including context    |

The timing reporter cannot interrupt the measured operation. Reporter failures are ignored, while operation failures are recorded and rethrown normally.

## Results

The dominant avoidable startup operation was removed: automatic diagnostics no longer wait for a discarded Foundry response. Client initialization overhead was also reduced by sharing one Foundry client across all four workflows.

A controlled before-and-after live benchmark has not yet been captured, so no percentage latency reduction is claimed. The packaged Electron smoke test completed in 8.1 seconds after the changes, but this is a full UI test and is not a direct startup or Foundry latency benchmark.

Validation completed after the change:

- TypeScript typecheck passed.
- All 40 automated tests passed.
- The packaged Electron smoke test passed.

## Benchmark Procedure

Use the same identity, network, MSX portfolio, Foundry project, and agent prompt for each run. Capture at least one cold launch and five warm runs.

1. Launch the desktop app in live mode and collect all `[performance]` log entries.
2. Record each MSX phase and their sum for initial hydration.
3. Run each Foundry workflow with a fixed prompt.
4. Record `agent.context.msx`, `agent.context.mcem`, and `agent.invoke.<capability>`.
5. Report median and 95th-percentile duration separately for cold and warm runs.
6. Compare against a baseline collected under the same conditions.

Do not use the packaged smoke duration as a substitute for these phase metrics.

Selected-opportunity evidence is loaded lazily and cached by opportunity ID. It therefore does not add a milestone request to initial portfolio hydration.

## MCEM guidance investigation (2026-10-21)

Desktop, Web, the VS Code extension, and Teams send explicit guidance prompts through
the same shared agent-task operation. Independent milestone and MCEM-guidance reads now
overlap after opportunity/account authorization succeeds, rather than running serially.
The authoritative local stage evaluation, evidence, source-health flags, model binding,
and complete response remain unchanged. Generated advice is not cached.

The complete agent request and the previously unmeasured milestone phase are timed.
Desktop already reports these timings. Set `TLC_PERFORMANCE=1` before starting the Web
host or VS Code extension host to enable the same privacy-safe phase logs; Teams accepts
this switch or its existing `TLC_TEAMS_PERFORMANCE=1`. No prompt, response, customer
identifier, or credential is included.

Controlled baseline checks before this change:

| Check | Observed duration |
| --- | --- |
| Synthetic context preparation, cold / warm | 148 ms / 1 ms |
| Live MSX context plus milestones, warm connector | 751 ms |
| Live MSX context plus milestones, new connector | 3,543 ms |
| Live Foundry synthesis using sanitized fixture context | 13,682 ms |

These are individual observations, not a production percentile or an end-to-end
latency guarantee. The reported minute-long delay was not reproduced. Source reads
and model inference must be measured in the affected session before attributing that
delay to either. Parallel context reads remove avoidable waiting but do not eliminate
model generation, service load, authentication, or network latency.

A subsequent six-request run through the optimized shared operation used the same
sanitized opportunity and live Foundry deployment. Full-operation time was 9,654 ms
on the cold request, with a 7,848 ms warm median and 9,238 ms warm p95 across five warm
requests. Each completed in less than 60 seconds. These measurements exclude live
MSX and UI transport latency, and service variability means they are not an
attributable before/after speedup for the context-parallelism change.

The tested Foundry agent-reference API rejects request-level reasoning overrides.
Do not add unsupported generation settings, shorten the timeout as a substitute for
optimization, silently replace Foundry with deterministic text, or truncate the answer.
The active test environment also had different agent instructions from the repository;
no deployed agent was modified during this investigation.

### Repeatable, opt-in MCEM benchmark

Run the [MCEM latency benchmark](../../tests/connectors/mcem-guidance-latency.live.test.ts)
with Azure CLI authenticated for the configured Foundry environment:

```powershell
$env:TLC_RUN_LIVE_SMOKE = '1'
try {
    npm test -- tests\connectors\mcem-guidance-latency.live.test.ts
}
finally {
    Remove-Item Env:TLC_RUN_LIVE_SMOKE
}
```

It submits only sanitized fixture context, performs one cold and five warm calls,
and prints per-phase cold, warm median, and warm p95 durations without content or
identifiers. It makes real, billable Foundry calls but does not read or write live MSX
records or change an agent deployment. The default test suite skips it. Use the
in-product phase logs separately to include real MSX and transport latency.
Set `TLC_MCEM_BENCHMARK_OUTPUT` to a local JSON file path to persist the timing summary.

## Session-local Portfolio and Discovery reads

Desktop, Web, VS Code, and Teams share the browser-safe
[session read models](../../apps/shared/session-portfolio.ts) and
[adaptive cache](../../apps/shared/session-cache.ts). Desktop's trusted main process
and VS Code's provider own their physical caches; the webview and native VS Code tree
reuse the same provider session, including when the webview is recreated. Web and
Teams own their read caches in the browser. No read dataset is put in local storage,
the mutation journal, or a cross-user server runtime.

- Portfolio's initial aggregate index is loaded once. Account selection, repeated
  navigation, search, sorting, and hidden-account filtering reuse it.
- Discovery stays lazy until first activation. A new, independently versioned
  `getDiscoverySnapshot` operation reads current scope and all open opportunities
  for visible accounts. MSX domain classification is performed over raw option codes
  from that capture, preserving the existing technical-capability **OR** conversation
  rules. The connector paginates/chunks as necessary, but does not issue eight
  domain-specific scans.
- The complete Discovery snapshot is shared by all eight domain tabs. Domain switches
  and customer include/exclude filters issue **zero** additional source reads.
- If Discovery loads first, its Portfolio subset seeds the Portfolio cache. If
  Portfolio loads first, Discovery remains unloaded until opened.
- Milestones are loaded only on the first expansion of an opportunity, then reused
  across Discovery and Portfolio. Details are not eagerly fetched for every result.
- Explicit **Refresh** invalidates and revalidates loaded data. Confirmed values remain
  available while revalidation runs, with failures/staleness shown rather than a
  misleading empty success. Scope/identity resets, unlike ordinary refresh, purge data.
  Ordinary pane navigation does not refetch a fresh dataset.
- Confirmed account visibility, Deal Team, and milestone-team changes update cached
  rows across domains and the Portfolio membership view. Failed or cancelled writes
  do not alter the cache. Authoritative write checks and concurrency protection stay
  on the server. Ambiguous membership or committed batch/meeting changes may require
  write reconciliation; they are not treated as ordinary navigation reads.
- Adding/unhiding a customer patches accounts and cached directory-search state.
  If the original capture did not cover that customer's visible scope, one necessary
  revalidation loads the missing opportunities. Hiding and unhiding an already
  captured scope remains local.
- Failed loads are not cached as empty successes. Refresh/retry errors remain visible.
  Mode/source changes and client disposal discard the cache, and late results from
  an older cache generation cannot populate the new session.

`POST /api/discovery/snapshot`, `tlc:discovery-snapshot`, the VS Code
`getDiscoverySnapshot` bridge method, and the Teams operation expose the same strict
v1.0 request/response. Existing Portfolio contracts and per-domain APIs remain
compatible. The Web host still builds a delegated, per-request runtime; the cache
does not weaken server-side source authorization.

This cache covers browsing reads, not model-generated advice, reviewed write
previews, or Play workflow queries. Explicit agent tasks still build trusted,
current context in the shared orchestrator.

A read-only live MSX check captured the snapshot in 4,255 ms, including scope and
membership reads. The all-domain discovery data spanned two HTTP page reads within
one capture. After that capture, 24 domain switches with customer filtering plus
repeated Portfolio account/index/opportunity reads took 91 ms in total and issued
**zero additional MSX HTTP requests**. These are observations for that source scope,
not a guarantee for larger portfolios; pagination and account chunking remain enabled.

## Adaptive freshness and confirmed background writes

The independently versioned [cache/synchronization contract](../../packages/common/contracts/cache-sync.ts)
sets these initial policies:

| Policy | Default |
| --- | --- |
| Loaded mutable UI datasets | Eligible after 5 minutes |
| Loaded reference/creation catalogs | Eligible after 30 minutes |
| Background refresh | One group per private source session; loaded, visible interests only |
| Inactive datasets / serialized read budget | 100 entries / 64 MiB; no silent truncation of complete captures |
| Read retries | At most 2; honor `Retry-After`, including the final failed attempt |
| Confirmed source writes | At most 2 independent background writes, with per-record admission fences |
| Terminal receipt retention | Eligible for maintenance cleanup after 30 days |
| Unresolved receipts | Retained and bounded; never automatically replayed or silently removed |

Milestones, activities, catalogs and exact directory searches load on demand.
Hidden panes do not start refreshes or throttled retries. Focus/reconnect resumes
eligible work, not a poll of every record. Subscribers receive coherent updates
without remounting dirty editors or replacing their unsent text. The UI's last-checked
time reflects the physical host owner, not a warm mirror download.
Read-model revisions are distinct from focus/interest metadata: merely activating a
consumer does not invalidate unchanged data or trigger another snapshot transfer.

Read caching is on independently of background writes. **`TLC_BACKGROUND_SYNC=1`**
opts into the [shared trusted mutation host](../../packages/orchestrator/mutations/host.ts)
only when protected durable storage is available. A user still explicitly
Save/Add/Remove/confirms the reviewed action; no keystroke autosave, offline replay
queue, automatic approval, or background LLM call is introduced.

1. Prepare against current source authorization and original editor values.
2. Bind the exact normalized input, original native versions and actor to a private review.
3. Persist/CAS-claim the confirmed intent before immediate execution.
4. Show proposed changes as **pending**, separately from canonical cached facts.
5. On source acknowledgement, reconcile canonical values. The native connector
   distinguishes preflight failures from requests actually dispatched.
6. On `412`, keep the draft and require a fresh current-values review. Lost responses,
   read-back failure, or receipt-persistence failure remain uncertain; do not repeat the write.

Cached data, optimistic overlays and approvals never become agent evidence.
Editor bases are captured from the actual record/field, bounded separately, and
frozen before asynchronous preparation so navigation cannot mint a fresh ETag for
an older draft. The shared synchronization panel offers current-values review and
read-only reconciliation; it does not automatically retry a mutation.

### Storage and supported operation classes

| Host | Private durable receipts |
| --- | --- |
| Desktop | `userData\mutation-state\<mode>.sqlite`; live payloads encrypted with a master key protected by Electron `safeStorage` |
| VS Code | `globalStorageUri\mutation-state\<mode>.sqlite`; live master key in VS Code SecretStorage; Sample background support requires a source-core/SQLite provider |
| Web live | Existing Azure Table via `TLC_MUTATION_TABLE_URL`, optional `TLC_MUTATION_TABLE_NAME` (default `TlcMutations`); managed identity in App Service |
| Web Sample | Local SQLite via `TLC_MUTATION_STATE_PATH`, default `.tlc\web-sample-mutations.sqlite` |
| Teams | Existing protected local/hosted runtime state; in-memory state is not advertised as durable |

No Azure resource/table or role assignment is created automatically. Keep local
databases and their original protected keys together; do not delete an unresolved
journal or regenerate its key. Normalized write inputs and native version proofs are
protected business state, including the confirmed approval reason. Full before snapshots,
access tokens and canonical result payloads
are not persisted in the new journal.

Live background admission supports profile preferences and metadata-capable,
exact-version Opportunity/Milestone updates and configured stage transitions.
Unmapped fields and existing unsupported MSX creation remain rejected. Live membership
POSTs/activity creation keep the existing acknowledged/reviewed paths, not a claimed
exactly-once background guarantee. Teams meeting application keeps its server-owned
draft/review boundary. Capability responses list the supported subset.

### Recovery, shutdown and rollback

- Reopen with the same source identity to discover private pending receipts. Matching
  current state is `reconciled-current-state`, not proof that a lost response was received.
- Unauthorized/source-identity changes purge browsing data and reject late-ready results.
  Web continues authenticating and composing a delegated runtime **per HTTP request**.
- Desktop initializes protected storage after Electron readiness (no top-level ready
  deadlock), drains admitted work on quit, and handles keep-open/cancel safely. Web,
  VS Code and Teams also bound shutdown drain time.
- Set `TLC_BACKGROUND_SYNC=0` to disable new background admission while retaining
  configured storage/keys. Existing receipts remain readable/reconcilable; a pending
  or uncertain record is fenced from another client write. Do not remove the receipt
  store as a rollback shortcut.
- Missing protected storage explicitly leaves acknowledged mode available. An invalid
  encryption key or failed protected-store initialization is an error, not a silent
  switch to an unprotected queue.

Deterministic cache, two-store claim, actor, retention, fault and four-transport tests
are in [cache tests](../../tests/unit/common/session-cache.test.ts),
[mutation tests](../../tests/unit/orchestrator/mutation-sync.test.ts),
[recovery tests](../../tests/unit/orchestrator/mutation-recovery.test.ts) and
[transport parity](../../tests/unit/hosts/mutation-sync-transport-parity.test.ts).
The [feature-on four-UI journey](../../tests/e2e/revamp/cache-synchronization.spec.ts)
uses sanitized local sources and controlled latency, not live MSX writes.
