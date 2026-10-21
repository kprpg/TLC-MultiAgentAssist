# Teams Live Performance Assessment

**Status:** original assessment retained below; the first implementation is recorded in [section 10](#10-implementation-status), with further shared-backend changes and measured protocol results in [section 11](#11-shared-backend-follow-up-and-performance-measurements).
**Scope:** Teams desktop client with the local Azure CLI backend, Live mode only.  
**Source baseline:** `c7d64dc9498601047ded528cc7c7f274d183fa59`, branch `feature/vscode-extension-Teams`.  
**Observed runtime:** app `1.2485.4790`, `local-azure-cli`; Node `v24.11.1`, Azure Identity `4.13.2`, Teams JS `2.58.0`.  
**Assessment date:** 2026-10-21.

Sections 1-9 describe the pre-optimization source baseline above. The subsequent
implementation started at `1b4441c9bb05c957e78ed8273d42c136ccee0e2d`; source
line positions can move as those recommendations are applied. No implementation
was automatically deployed into the user's running Live backend.

## 1. Executive assessment

The code supports a more specific explanation than "Teams is inherently slow":
**Teams repeatedly performs fresh portfolio hydration and credential work, and
some screen interactions multiply those reads.** The shared backend does not
mean that every host has the same cache lifetime, credential path or loading
sequence.

The highest-confidence opportunities are:

1. **Reuse the existing bounded read context inside composite read operations.**
   Snapshot, MCEM and Guidance read the opportunity context and then its milestones.
   With Teams' fresh-read configuration, this can load the portfolio twice in one
   logical operation. An isolated probe reduced a snapshot from **11 to 7 source
   reads/token-provider calls**, with identical output.
2. **Make loading states cover the whole user journey.** Portfolio stops showing
   its main loading indicator after accounts arrive, although opportunities and
   milestones are still loading. New has no explicit initial account-loading
   state. These make real waits look like empty or broken screens.
3. **Remove focus-triggered portfolio-search fan-out.** Focusing the Teams search
   box starts `1 + A` application requests for `A` visible accounts, even before
   typing. Each account read can hydrate the full portfolio again.
4. **Load the selected Portfolio workspace through one fresh capture.** Three
   independently refreshed account/opportunity/milestone reads produced **17
   source reads** in an isolated probe; one bounded capture produced **7**, with
   identical results and a fresh source check on the next capture.
5. **Optimize CLI acquisition carefully, after reducing unnecessary reads.**
   Teams rechecks the CLI subject on every token dispatch. Desktop reuses an
   unexpired token. This difference has real cost potential, but copying the
   Desktop cache policy would weaken Teams' current account-switch protections.

**These are not measured native speedup percentages.** Authenticated customer
queries, actual Teams rendering and model execution could not be timed safely
through the available tooling. The user accepted a source-backed report and
requested the closest safe equivalent. This assessment therefore combines
current-code traces, existing deployed asset measurements and deterministic
Live-path request-count probes, and identifies the remaining measurement gaps.
No Sample-mode latency is used.

### Reading the evidence

| Label | Meaning |
| --- | --- |
| Observed Live metadata | A real request to the existing backend, but not a customer-data operation or native rendering measurement. |
| Measured deployed artifact | Existing deployed files measured without rebuilding or changing the application. |
| Controlled Live-code probe | Current Live classes with synthetic responses and injected credentials; proves mechanics/counts, not tenant or native latency. |
| Code-confirmed | A behavior visible in the current source. Its production latency contribution remains unquantified. |
| Hypothesis | Plausible contribution requiring a native trace, source metrics or larger-data measurement. |

## 2. Greatest bang for the buck

Ranking weighs likely benefit, affected screens, evidence confidence, engineering
complexity and security/regression risk. **S/M/L are change-size categories, not
delivery estimates.** "High benefit" means expected benefit, not a measured
production result. IDs are stable so improvements can be requested individually.

| Rank | Selectable item | Principal benefit | Size | Risk | Evidence / return |
| --- | --- | --- | --- | --- | --- |
| 1 | [TPERF-01: bounded read coalescing](#tperf-01) | Fewer source reads and credential dispatches in snapshots, MCEM and Guidance | S-M | Low-Medium | Strongest controlled evidence; 11 -> 7 reads for a snapshot. Very high expected return. |
| 2 | [TPERF-02: truthful staged loading](#tperf-02) | Portfolio, New and Guidance feel responsive instead of empty/hung | S | Low | Code-confirmed gaps. High UX return; does **not** claim faster source queries. |
| 3 | [TPERF-03: eliminate search focus fan-out](#tperf-03) | Avoid repeated full-portfolio bursts from the header across screens | M | Medium | Code-confirmed `1 + A` request pattern. Very high return when search is used. |
| 4 | [TPERF-04: one fresh Portfolio workspace read](#tperf-04) | Remove serial data-loading stages and repeated hydration | M-L | Medium | Controlled 17 -> 7 source reads. High return for routine account/opportunity work. |
| 5 | [TPERF-05: safe CLI acquisition coalescing](#tperf-05) | Reduce duplicate CLI process/JWT work during concurrent reads | M | Medium-High | Credential-policy difference confirmed. Potentially broad benefit; strict security constraints. |
| 6 | [TPERF-06: Discovery re-entry and refresh behavior](#tperf-06) | Avoid blanking useful results and unnecessary repeated loading | S-M | Medium | Current re-entry clears and reloads; Desktop/Web retain a loaded-domain state. High repeat-navigation value. |
| 7 | [TPERF-07: public-asset caching](#tperf-07) | Faster initial load and recreated-webview entry | S-M | Low-Medium | One deployed JS bundle is 1,135,758 bytes; global `no-store` reaches static serving. Not a steady-state query fix. |
| 8 | [TPERF-08: selective, bounded Discovery queries](#tperf-08) | Reduce long initial Discovery loads for large working sets | M-L | Medium-High | Sequential 40-account chunks and full result materialization confirmed; actual dataset impact unmeasured. |
| 9 | [TPERF-09: propagate read cancellation](#tperf-09) | Stop obsolete source work after navigation or domain changes | M-L | Medium | Browser abort exists; connector requests lack the corresponding cancellation signal. Best under rapid interaction. |
| 10 | [TPERF-10: cost-aware Plays progress](#tperf-10) | Reduce expensive repeated scope capture while waiting for a Play | M | Medium-High | Each `workflows.get` verifies a fresh working set; client schedules another poll after completion. Preserve disclosure checks. |
| 11 | [TPERF-11: render less hidden/large UI](#tperf-11) | Better typing, filtering and tab responsiveness with large lists | M | Medium | Full tables and hidden tab content are mounted. Native CPU/jank contribution remains a hypothesis. |

**Measurement enabler, not a speedup:** implement [TPERF-00](#tperf-00) alongside
the first selected change. Existing timing hooks are not connected to a Teams
phase reporter by the application factory.

**Recommended first selection:** TPERF-01 + TPERF-02 + TPERF-00.
Then prioritize TPERF-03 if search is part of the slow journey, otherwise
TPERF-04 for ordinary Portfolio use. Do not begin by removing authorization,
raising request quotas, replacing models or rewriting the Teams UI.

## 3. Why the four surfaces differ

| Layer | Teams local CLI | Desktop | Web | VS Code extension |
| --- | --- | --- | --- | --- |
| UI / transport | Separate React UI; one HTTP operation per client request | Shared revamp UI; Electron IPC | Same revamp UI as Desktop; HTTP | Separate webview; extension bridge |
| Portfolio lifetime | Shared application factory sets `cachePortfolio: false`; service resolution and operation dispatch refresh source state | Connector uses default portfolio memoization in a long-lived host | Hosted runtime factory creates a connector per authenticated request; default memoization still helps **inside** that request | Live provider constructs a connector with default memoization and retains it through provider lifetime |
| MSX credential path | Each connector HTTP request asks `CliIdentityProvider` for a token; that acquires and validates the current CLI subject | `AzureCliMsxTokenProvider` returns its cached token until its expiry buffer | CLI authentication acquires a token for the application request; the runtime supplies that incoming token to downstream reads | VS Code Microsoft authentication session supplies the token callback |
| Discovery revisit | Active/domain effect clears results and refetches | Loaded-domain state can avoid a revisit fetch; explicit refresh remains | Same browser behavior as Desktop's shared renderer | Domain/refresh effect loads data; this is **not** proof that extension Discovery has a durable cross-panel cache |
| Search | Loads all accounts and per-account opportunities on every focus; view changes reset the index | Search uses a supplied index; account refresh builds that index | Same UI as Desktop; its initial index build can still have expensive per-account HTTP calls | Some panels also build portfolio indexes; not all fan-out is Teams-exclusive |
| Guidance | Current CLI branch selects deterministic Live task agents; MCEM evaluation is local over Live evidence | May use configured Foundry agents | Hosted runtime configures Foundry agents | Can use Foundry agents or a deterministic fallback |

Sources: [Teams composition](../../packages/orchestrator/application-runtime.ts#L83),
[Teams service reuse](../../apps/teams/src/server.ts#L114),
[operation dispatch](../../packages/orchestrator/operations.ts#L92),
[Desktop token provider](../../apps/desktop/electron/main/azure-cli-token-provider.ts#L39),
[Web authentication](../../apps/web/src/authentication.ts#L13),
[Web runtime](../../apps/web/src/runtime.ts#L60),
[extension provider](../../apps/vscode-extension/src/live-provider.ts#L80),
[extension authentication](../../apps/vscode-extension/src/authentication.ts#L28).

Important qualifications:

- The comparison surfaces were inspected **through code**, not Live-benchmarked.
  There is no measured "Teams is N times slower" conclusion.
- The current Web runtime is not universally warm-cached across requests. It has
  its own optimization opportunities. Do not use historical architecture notes
  as proof that every Web/extension path is already efficient.
- A CLI credential acquisition is **not necessarily a new Entra login or remote
  token issuance**. Azure CLI can use its own cache; the extra process invocation
  and validation work still occur in the inspected SDK path.
- Teams' source freshness and account-switch protection are deliberate. They
  cannot simply be replaced with the Desktop token/portfolio lifetime.

### A representative request waterfall

```text
Portfolio entry
  listAccounts
    -> admission / quota -> service resolution -> fresh portfolio -> CLI + MSX reads
  account selected
    -> listOpportunities -> another fresh portfolio -> CLI + MSX reads
  opportunity selected
    -> listMilestones -> another fresh portfolio -> milestone reads

Snapshot / MCEM / Guidance
  getOpportunityContext -> portfolio + evidence
  listMilestones       -> portfolio again when not inside a bounded read context
  evaluation / task rendering
```

`refreshSource()` is called in service reuse and again in operation invocation.
It clears portfolio, observation, milestone, identity and version state.
Separately, `cachePortfolio: false` makes `getPortfolio()` reload unless an
explicit read context is active. **Deleting a refresh call alone will not
restore warm reuse**, and deleting all freshness checks is not the proposed fix.

Sources: [refresh](../../packages/connectors/msx/live.ts#L1050),
[read-context behavior](../../packages/connectors/msx/live.ts#L1154),
[snapshot](../../packages/orchestrator/index.ts#L140),
[MCEM/Guidance](../../packages/orchestrator/index.ts#L257).

## 4. Screen-by-screen diagnosis

| Screen / interaction | Confirmed behavior | Likely symptom / contribution | Select |
| --- | --- | --- | --- |
| Discover initial load / domain change | Hydrates visible portfolio, then queries active opportunities for authorized accounts in sequential chunks of 40; buffers all pages | Long all-or-nothing wait, amplified by CLI acquisitions per source request | 00, 05, 08, 09 |
| Discover revisit / customer filter | Revisit clears and refetches. Include/exclude filtering and sorting are local, after source load | Repeated blanking and waiting; large result sets can add main-thread work. Filters do not currently reduce the source query | 02, 06, 08, 11 |
| Discover milestone expansion | Fetches milestones on expansion; re-expanding can fetch again | Additional wait, but **not** automatic milestone fan-out over every Discovery row | 02, 06 |
| Portfolio entry / account selection | Accounts, opportunities and milestones load through dependent effects; only the initial account phase controls the main loading indicator | Three fresh source captures and misleading empty/intermediate UI | 01, 02, 04 |
| Header search | Focus starts one account read plus one opportunity read per visible account; every view change clears the search index | Bursts, repeated work, quota pressure and source contention while using any screen | 03, 05, 09 |
| Guidance / MCEM | Context read followed by milestone read; single "Grounding response..." / "Evaluating..." state; whole JSON response awaited | Repeated hydration and no phase attribution. Current CLI slowness is **not evidence of Foundry model latency** | 00, 01, 02 |
| Plays catalog / history | Loads catalog, local connection status and history; UI has explicit loading/error/retry state | Catalog loading is distinct from actual MCP execution; do not classify unavailable MCP as a performance timeout | 00, 02 |
| Running Play / opening a result | Every `workflows.get` verifies current source working set before returning results | A status fetch can itself be a source-heavy read; repeated polling prolongs apparent waits | 00, 10 |
| New | Loads accounts on mount without an account-loading state, then loads a creation catalog after account selection | Empty picker can look unimplemented while a fresh portfolio read is pending; catalog also reads reference data | 01, 02, 04 |
| Meetings | CLI disables Graph meeting-link lookup; manual transcript handling remains available | Unsupported Graph is a capability limitation, not a source query to optimize. Manual processing can still need fresh snapshots | 00, 01, 02 |
| Dashboards | Live Teams explicitly disallows the operator's private local seller profile | Unavailability is intentional, not proof of a slow dashboard query | Capability message only |
| Activity | Reads private local action/notification/workflow state; still passes common service resolution | Distinguish local-store work from MSX; profile before database tuning | 00, 02 |
| Initial load / return from another Teams entity | SDK/config/session startup plus a separate webview lifecycle; page may be recreated | Asset/bootstrap cost and manual re-pairing friction are separate from steady-state source latency | 07, 11; preserve pairing policy |

Primary UI references:
[accounts](../../apps/teams/src/client/accounts.tsx#L61),
[Discover](../../apps/teams/src/client/discovery.tsx#L31),
[search](../../apps/teams/src/client/portfolio-search.tsx#L20),
[Guidance](../../apps/teams/src/client/guidance-workspace.tsx#L18),
[MCEM workbench](../../apps/teams/src/client/opportunity-workbench.tsx#L30),
[Plays](../../apps/teams/src/client/workflows.tsx#L46),
[New](../../apps/shared/record-creation/new-workspace.tsx#L92),
[Meetings](../../apps/teams/src/client/meetings.tsx#L33),
[Activity](../../apps/teams/src/client/activity.tsx#L16).

## 5. Selectable improvement cards

<a id="tperf-00"></a>
### TPERF-00 - Connect privacy-safe phase timing

**Type:** measurement enabler. **Scope:** all Live journeys. **Size:** S-M.

- **Evidence:** `measurePerformance` already records operation, duration and
  outcome, but Teams constructs its orchestrator/connector without a reporter.
  End-to-end HTTP timing cannot distinguish CLI acquisition, source pagination,
  MCEM parsing/evaluation and rendering.
- **Remedy:** wire an explicit, privacy-safe reporter through shared factories.
  Add operation/request correlation and separate credential, source, queue,
  serialization, first feedback and settled-UI phases. Record source request
  counts and cache/coalescing outcomes.
- **Acceptance:** one slow journey can be attributed by phase; only approved
  technical fields are emitted. No prompt, customer, token, transcript or
  response-content logging. Avoid identifiers in metric dimensions.
- **Dependencies / caution:** none for the initial reporter plumbing. Runtime
  instrumentation is a future implementation, not something enabled by this
  investigation. It does not itself make queries faster.

References: [timing helper](../../packages/common/telemetry/performance.ts#L8),
[factory wiring](../../packages/orchestrator/application-runtime.ts#L38),
[agent phase hooks](../../packages/orchestrator/index.ts#L276).

<a id="tperf-01"></a>
### TPERF-01 - Coalesce repeated reads within one fresh operation

**Type:** actual backend work reduction. **Size:** S-M. **Best first backend pick.**

- **Evidence:** snapshot, MCEM and Guidance call context and milestone methods
  sequentially; both can hydrate the portfolio. Current normal read dispatch
  does not wrap them in the existing `withReadContext` capability.
- **Remedy:** use one bounded read context for the applicable composite read
  operation, after admission/source refresh. Reuse the existing shared helper;
  do not create a Teams-only orchestrator or an unbounded cross-request cache.
- **Measured mechanism:** the controlled snapshot returned identical data with
  **2 -> 1 portfolio scans; 11 -> 7 source reads/token-provider calls**.
- **Acceptance:** assert one portfolio capture inside a snapshot, MCEM evaluation
  or Guidance context build. An independent or concurrent capture still performs
  its own source check. Source/identity changes and denied access fail closed.
- **Dependencies / guardrails:** no new UI wire shape is inherently required.
  Retain lifecycle/generation checks, conditional writes and separate review/
  commit freshness. Do not broadly wrap mutations or retain reviewed-version
  state for later operations.

References: [normal dispatch](../../packages/orchestrator/operations.ts#L92),
[existing helper](../../packages/orchestrator/application-runtime.ts#L43),
[connector context](../../packages/connectors/msx/live.ts#L1154),
[freshness regression](../../tests/connectors/msx-request-scope.test.ts#L29).

<a id="tperf-02"></a>
### TPERF-02 - Show truthful progress through every loading stage

**Type:** perceived responsiveness and diagnosis, not source-query acceleration.
**Size:** S. **Best low-risk UX pick.**

- **Evidence:** Portfolio sets `loading=false` when accounts return; opportunity
  and milestone requests continue separately. New initially presents an empty
  account array without an account-loading flag. Guidance reports one generic
  busy phase until the response is complete.
- **Remedy:** distinct account, opportunity, milestone and catalog states;
  skeletons/placeholders in the affected pane; explicit loading/error/empty
  distinctions; targeted retry. Keep navigation and unrelated panes usable.
  Start with client-known phases; add server phases only with TPERF-00.
- **Acceptance:** a delayed source never produces "no eligible opportunities"
  while the current opportunity read is pending. New says "loading accounts"
  rather than suggesting no accounts exist. Every pending/error state has an
  accessible status and a bounded, explicit recovery path.
- **Guardrails:** do not display invented percentage completion or claim success
  on failure. Do not auto-retry writes, clear unsaved drafts or enable actions
  against a loading/changed scope.

References: [Portfolio effects](../../apps/teams/src/client/accounts.tsx#L61),
[empty-state rendering](../../apps/teams/src/client/accounts.tsx#L151),
[New account load](../../apps/shared/record-creation/new-workspace.tsx#L92),
[Guidance busy state](../../apps/teams/src/client/guidance-workspace.tsx#L18).

<a id="tperf-03"></a>
### TPERF-03 - Stop rebuilding global search on focus

**Type:** source fan-out and burst reduction. **Size:** M.

- **Evidence:** `PortfolioSearch.load()` requests accounts, then executes
  `Promise.all` over `listOpportunities` for every visible account. `onFocus`
  starts it even with an empty query; the context key includes the current
  view, so navigating resets the index. This is **1 + A application calls** per
  focus, not just an inexpensive local search.
- **Why it matters:** each call can incur a fresh portfolio capture and CLI work.
  The Live request budget is 60 application requests per minute window; a large
  account set or repeated focuses can consume it without a user issuing 60
  intentional searches. Do not fix this by merely raising the limit.
- **Remedy:** make focus local. Reuse an authorized, explicitly invalidated
  portfolio index where available; otherwise add one bounded shared-core search/
  index operation instead of per-account HTTP fan-out. Deduplicate in-flight
  loads and use a bounded query trigger. Do not use global account search to
  broaden portfolio-search semantics.
- **Acceptance:** focusing/refocusing an empty search box causes zero new source
  scans. One necessary refresh uses one bounded capture, with bounded results.
  Membership/visibility changes, mode changes, disconnect and identity changes
  invalidate the index. A late result cannot select an obsolete scope.
- **Dependencies:** TPERF-01 for an aggregate read. Any new operation needs strict
  shared contracts and transport-parity tests.

References: [Teams search](../../apps/teams/src/client/portfolio-search.tsx#L20),
[view reset key](../../apps/teams/src/client/app.tsx#L229),
[quota application](../../apps/teams/src/app.ts#L217),
[minute-window budget](../../packages/orchestrator/collaboration/request-budget.ts#L9).
Desktop/Web's [search component](../../apps/desktop/renderer-revamp/src/portfolio-search.tsx#L11)
uses a supplied index, although its [index build](../../apps/desktop/renderer-revamp/src/App.tsx#L798)
also has fan-out to consider in a later cross-surface improvement.

<a id="tperf-04"></a>
### TPERF-04 - Load a Portfolio workspace in one fresh capture

**Type:** round-trip and source-work reduction. **Size:** M-L.

- **Evidence:** the accounts -> opportunities -> milestones dependency chain
  issues three separately refreshed reads. In the controlled fixture this meant
  **3 portfolio scans, 3 identity reads and 17 source/token-provider calls**.
- **Remedy:** define a focused shared orchestrator read that returns the
  authorized working-set/selected-scope data required to render the workspace,
  using one bounded read context. Alternatively, begin with a narrow combined
  selected-opportunity read. Keep UI defaults and scope changes explicit.
- **Measured mechanism:** combining the three reads inside one existing bounded
  capture returned identical output with **1 portfolio scan, 1 identity read and
  7 source/token-provider calls**. This is not a measured HTTP or native speedup.
- **Acceptance:** one capture per initial workspace read; a new selection or
  explicit refresh rechecks current source access. Invalid/unavailable selected
  records do not silently switch the user into another customer.
- **Dependencies / guardrails:** TPERF-01; strict versioned contracts, operation
  tests and transport parity. Bound channel/meeting scopes, draft-discard
  behavior, mode isolation and review approvals remain unchanged.

References: [Portfolio effects](../../apps/teams/src/client/accounts.tsx#L61),
[operation catalog](../../packages/orchestrator/operations.ts#L32),
[shared orchestrator](../../packages/orchestrator/index.ts#L140).

<a id="tperf-05"></a>
### TPERF-05 - Reduce duplicate CLI acquisition without weakening identity checks

**Type:** credential-process overhead. **Size:** M. **Security design required.**

- **Evidence:** every MSX `requestJson()` obtains a token. Teams
  `CliIdentityProvider.getToken()` calls `acquire()`, which invokes
  `AzureCliCredential.getToken()` and validates the signed subject. The installed
  Azure Identity implementation executes `az account get-access-token`.
  Desktop has an explicit unexpired-token cache.
- **Controlled result:** two sequential Teams dispatches invoked the injected
  credential twice; two Desktop token reads invoked it once. CLI subject-switch
  revocation was verified separately. No real CLI-process duration was measured.
- **Remedy:** first reduce source dispatches with TPERF-01/03/04. Then consider
  coalescing truly concurrent acquisitions for the same resource and owner
  generation. Any longer operation-scoped token lease needs an explicit policy
  decision about detecting CLI account changes during that operation.
- **Acceptance:** concurrent callers avoid redundant acquisition where safe;
  expired/revoked tokens, wrong tenant/audience/subject, owner disconnect and
  account switches still fail closed. No source token reaches the browser.
- **Do not implement:** copying Desktop's expiry-only cache, skipping signature
  or subject validation, persisting browser capabilities, or treating a changed
  CLI account as the previously approved owner.

References: [CLI provider](../../apps/teams/src/cli-identity.ts#L34),
[per-dispatch check](../../apps/teams/src/cli-identity.ts#L109),
[MSX dispatch](../../packages/connectors/msx/live.ts#L1303),
[Desktop cache](../../apps/desktop/electron/main/azure-cli-token-provider.ts#L39),
[account-switch test](../../tests/unit/teams/cli-identity.test.ts#L120).

<a id="tperf-06"></a>
### TPERF-06 - Avoid blank-and-reload Discovery navigation

**Type:** repeat-navigation work and perceived responsiveness. **Size:** S-M.

- **Evidence:** every activation/domain/refresh clears opportunities and expanded
  rows before fetching. Desktop/Web's loaded-domain state can avoid a revisit
  load. Teams also refetches expanded Discovery milestones on re-entry.
- **Remedy:** distinguish first load, explicit refresh and returning to a
  previously loaded view. Deduplicate identical in-flight reads. Preserve
  harmless UI selection/sort/filter state; consider retaining last verified
  results during revalidation with a clear freshness label.
- **Acceptance:** repeat navigation does not flash a false empty screen; refresh
  remains explicit; duplicate consumers do not start duplicate source work.
  Unauthorized or changed-identity results are cleared immediately.
- **Policy dependency:** a cross-request result TTL or stale-while-revalidate
  display is a freshness/security behavior decision, not a free cache win.
  Namespace by actual source principal, environment, mode, scope and relevant
  generation; invalidate after mutations and access changes. Never serve cached
  data as a successful fallback after denial.

References: [Teams Discovery](../../apps/teams/src/client/discovery.tsx#L31),
[Desktop/Web revisit guard](../../apps/desktop/renderer-revamp/src/App.tsx#L354),
[extension comparison](../../apps/vscode-extension/src/webview/app.tsx#L1636).

<a id="tperf-07"></a>
### TPERF-07 - Cache only public, content-hashed assets

**Type:** startup/recreated-webview cost. **Size:** S-M.

- **Evidence:** the deployed UI has one JS asset of **1,135,758 bytes** and one
  CSS asset of **47,697 bytes**. The server sets `Cache-Control: no-store` before
  static serving. No response-compression middleware is configured in this host.
- **Remedy:** explicitly cache content-hashed public JS/CSS/icons; keep HTML,
  `build.json`, public runtime configuration, readiness and **all private APIs**
  non-cacheable as appropriate. Consider compression if measured transfer cost
  warrants it. Do not introduce a service worker for private responses.
- **Acceptance:** hashed assets can be reused on reload; the current HTML/build/
  package identity is still fetched and mismatch checks remain truthful.
  Private data and capabilities never enter HTTP or service-worker caches.
- **Evidence limit:** local gzip calculation produced **315,544 bytes** for the
  JS asset. That is a possible encoded size, **not** observed network transfer
  or a native startup improvement. Loopback transfer may be less important than
  parse/evaluation and source queries.
- **Dependency:** coordinate cache headers with versioned release/build identity.
  This does not avoid manual pairing when Teams recreates the page.

References: [global headers](../../apps/teams/src/server.ts#L187),
[static serving](../../apps/teams/src/server.ts#L263),
[client build configuration](../../apps/teams/vite.client.config.ts#L10).

<a id="tperf-08"></a>
### TPERF-08 - Make large Discovery reads selective and bounded

**Type:** large-working-set source latency. **Size:** M-L.

- **Evidence:** Discovery obtains all visible portfolio accounts, then queries
  opportunities in sequential 40-account chunks. Each chunk can have multiple
  sequential OData pages. Include/exclude customer filters are applied after
  the complete result arrives.
- **Remedy:** evaluate server-side selection of already-authorized customers,
  narrower projections and progressive/paginated results. Where ordering and
  source limits permit, use bounded chunk concurrency rather than an unbounded
  `Promise.all`. Preserve deterministic final ordering and evidence completeness.
- **Acceptance:** initial render does not require materializing an unnecessarily
  broad result; customer filtering never broadens the user's visible-account
  scope. Query counts, bytes, source throttling and time to first usable row are
  recorded for representative working-set sizes.
- **Dependencies / guardrails:** reduce duplicate work and credential bursts
  first. New pagination/filter contracts require versioning and tests. Preserve
  trusted continuation URLs, query guards and signed opportunity values.
  Never clamp/drop legitimate financial values to avoid validation errors.
- **Evidence limit:** actual account counts, pages, response bytes and
  throttling were not observed for this user's tenant.

References: [Discovery query](../../packages/connectors/msx/live.ts#L735),
[account chunks](../../packages/connectors/msx/live.ts#L779),
[pagination](../../packages/connectors/msx/live.ts#L1270),
[client filtering](../../apps/teams/src/client/discovery.tsx#L29).

<a id="tperf-09"></a>
### TPERF-09 - Cancel obsolete reads beyond the browser boundary

**Type:** avoid wasted work during rapid navigation. **Size:** M-L.

- **Evidence:** Teams supplies browser abort signals and rejects late old-mode
  responses. The server invokes ordinary operations, and MSX `requestJson` /
  pagination do not receive that browser cancellation signal.
- **Remedy:** propagate a server-owned read-cancellation context to connector
  reads and check it before the next page/chunk or credential acquisition.
  Use existing transport cancellation facilities where available.
- **Acceptance:** after an abandoned domain/scope read, no further unnecessary
  pages start; a new selection remains responsive. Cancellation never becomes
  a successful empty result and does not pollute shared in-flight caches.
- **Guardrails:** read-only work only. Do not equate page navigation with
  cancelling an already-dispatched workflow/write or unknown write outcome.
  Do not attempt to serialize an `AbortSignal` into a wire contract.

References: [client abort](../../apps/teams/src/client/data-client.ts#L33),
[server invocation](../../apps/teams/src/app.ts#L350),
[connector requests](../../packages/connectors/msx/live.ts#L1288).

<a id="tperf-10"></a>
### TPERF-10 - Make Plays progress cost-aware

**Type:** running-workflow responsiveness. **Size:** M.

- **Evidence:** after a successful running/queued result, the UI schedules the
  next `workflows.get` after one second. The server verifies the current complete
  working set before disclosing a workflow view. A poll is not necessarily a
  cheap local status read.
- **Remedy:** instrument this cost; use visibility-aware/adaptive polling and
  avoid identical subscribers. If necessary, design a minimal private progress
  response separately from source-bearing output, with an explicit disclosure
  policy and contract.
- **Acceptance:** source captures per polling period are bounded and observable;
  output remains unavailable after scope/access changes. Pausing a poll does not
  report the workflow complete or silently cancel it.
- **Existing good behavior:** polls wait for the prior request before scheduling
  another, and source working-set capture already uses `withReadContext`.
  This is **not** an accusation of overlapping one-second requests or a proposal
  to re-add an optimization already present.
- **Dependencies:** TPERF-00; preserve current source-scope verification. Simply
  skipping `verifyWorkflow` is not an acceptable optimization.

References: [polling](../../apps/teams/src/client/workflows.tsx#L81),
[workflow source verification](../../packages/orchestrator/operations.ts#L72).

<a id="tperf-11"></a>
### TPERF-11 - Reduce hidden and large-list render work

**Type:** browser CPU, memory and input responsiveness. **Size:** M.

- **Evidence:** the account workspace remains mounted behind `hidden` outside
  its primary views; detail sections also use hidden content. Tables map the
  full result set, and sort/filter/customer-list calculations run during render.
  Collapsed row editors still contribute component state.
- **Remedy:** measure first. Memoize genuinely expensive projections; mount
  heavyweight inactive content on demand while retaining deliberate view state.
  Consider list virtualization for large measured datasets. Lazy-load code for
  infrequently used workspaces and hosted-only auth where appropriate.
- **Acceptance:** filtering/typing does not repeatedly rerender unrelated rows;
  first-use and repeat-use traces show less CPU/long-task work. Preserve keyboard
  navigation, focus, row expansion, screen-reader behavior and unsent edits.
- **Guardrails:** do not unmount forms indiscriminately or move more state into
  the main app component. Reuse browser-safe shared helpers/components; do not
  port a Node-backed renderer wholesale into Teams.
- **Evidence limit:** no native React profile, heap profile or long-task trace
  was obtained. The 1.14 MB bundle alone does not prove CPU jank.

References: [mounted workspace](../../apps/teams/src/client/app.tsx#L264),
[detail tabs](../../apps/teams/src/client/opportunity-workbench.tsx#L76),
[Discovery rendering](../../apps/teams/src/client/discovery.tsx#L29),
[Portfolio table/editors](../../apps/teams/src/client/accounts.tsx#L180).

## 6. Evidence collected and limits

### 6.1 Actual Live checks and existing deployed files

| Observation | Result | What it establishes |
| --- | --- | --- |
| `GET /api/health` | Ready, Teams, Live; 254.1 ms | Existing backend responded. |
| `GET /api/teams/modes` | Runtime Live, initial page mode Sample, local CLI; 254.1 ms | Both modes available; does **not** establish the active page mode. |
| `GET /api/teams/config` | Live, local CLI, public configuration 1.2; 196.1 ms | Public authentication profile. |
| Existing deployed UI assets | 1 JS, 1 CSS; sizes in TPERF-07 | Public payload footprint without rebuild. |
| Existing backend bundle comparison | Matches current local `dist` backend bundle | Useful backend build consistency evidence, not a source-revision attestation. |
| Client build comparison | Deployed and current local build IDs differ | Establish the correct client before a later native benchmark. Random per-build IDs alone do **not** prove a code regression or explain slowness. |

The three metadata requests were made once each, with normal TLS validation,
from separate fresh PowerShell clients. Their times include client/module/TLS
overhead; they are **not isolated server-processing times**, customer-query
latencies, a percentile sample, or values to add into a native startup estimate.

The native Teams webview was not attached to available browser tooling.
No new pairing, credential extraction, authentication changes or browser-preview
substitution were performed. The user explicitly accepted this limitation.
**The 12 permitted private diagnostic reads and one Guidance invocation were
not used.** No Live model call, workflow start or source write was performed.

### 6.2 Closest safe equivalent: current Live-code probes

A temporary isolated Vitest probe used current `LiveMsxConnector`,
`ThinSliceOrchestrator`, CLI identity and Desktop token-provider classes, with
synthetic source responses and injected credentials. It used the Live connector's
`cachePortfolio: false` and conditional-write configuration, not Sample mode.

The fixture had one account/opportunity, no milestone rows and no OData paging.
Actual memberships, pages and data size can increase the counts. Raw credential
or customer payloads were not recorded.

| Probe | Current path | Existing bounded capture / comparison | Verification |
| --- | --- | --- | --- |
| Opportunity snapshot | 2 portfolio scans; 11 source reads; 11 token-provider calls | 1 scan; 7 source reads; 7 token-provider calls | Identical snapshot output. |
| Accounts + opportunities + milestones, separately refreshed | 3 scans; 3 identity reads; 17 source/token-provider calls | 1 scan; 1 identity read; 7 source/token-provider calls | Identical workspace data; next independent capture rechecks source. |
| Two sequential credential dispatches | CLI: 2 injected credential acquisitions | Desktop: 1 for two sequential token reads | CLI subject-switch revocation remains enforced. Different security policies, not interchangeable implementations. |

All **3 controlled probe tests passed**. Their in-process execution times are
deliberately not presented as Live performance numbers.

Also executed, exit code **0**: **26 existing tests across 4 files passed**:

```powershell
npm test -- tests\connectors\msx-request-scope.test.ts `
  tests\unit\teams\source-revalidation.test.ts `
  tests\unit\teams\cli-identity.test.ts `
  tests\electron\azure-cli-token-provider.test.ts
```

These tests support the freshness and identity constraints. They do not replace
native Teams or tenant benchmarking.

### 6.3 What remains unmeasured

- Authenticated MSX query duration, real portfolio size, pages and source
  throttling for this user.
- Actual `az` process duration and JWT/JWK overhead per source request.
- Native Teams main-thread, WebView/host, GPU, memory and interaction timing.
- Actual first-feedback / first-usable-row / settled-screen times.
- Matched Live timings for Desktop, Web and VS Code.
- Actual Guidance invocation time. The current CLI code chooses deterministic
  task agents; Foundry timing would be relevant to a different enabled profile.

No root-cause percentage, p95, model bottleneck or production speedup is claimed
without that evidence.

## 7. Existing optimizations and misleading diagnoses to avoid

- **Service reuse exists.** Teams retains per-principal services with lifecycle/
  owner-generation checks. The issue is not simply a missing singleton.
- **Workflow capture coalescing exists.** Its bounded read context already avoids
  rehydration once per account inside one capture. Normal composite reads need
  the same scrutiny.
- **Milestone activities are lazy.** The activities component mounts only when
  its disclosure opens. Do not attribute automatic N-per-milestone activity
  requests to initial Portfolio rendering.
- **Client cancellation and stale-result rejection exist.** The remaining
  question is how far cancellation propagates into source work.
- **Health/readiness/status polls are not full portfolio reads.** The 10-second
  launcher check and 15-second connection check are visibility-aware and handled
  before normal service resolution. Removing them is not the first performance
  remedy. Lease renewal can perform identity work, but not on every status poll.
- **Guidance is not always an LLM call.** In the current CLI branch, task agents
  are deterministic and MCEM is local evaluation over Live evidence. Faster
  models, prompt trimming and streaming model tokens are not demonstrated fixes
  for this profile.
- **Graph/MCP availability is separate from speed.** CLI Graph is disabled;
  Live Plays require explicitly connected MCP. Do not retry unsupported
  capabilities as though they were slow data fetches.
- **Re-pairing after webview recreation is a security/lifecycle choice.** The
  user chose memory-only, manual per-page pairing. Do not introduce persistent
  cookies/tokens, bypass pairing, or promise a fictitious manifest cache flag.
- **Source errors are not necessarily timeouts.** Preserve explicit schema,
  authorization and quota errors. Longer timeout values do not remove repeated
  source work.

References:
[lazy activities](../../apps/teams/src/client/record-actions.tsx#L53),
[readiness](../../apps/teams/src/client/launch-status.tsx#L22),
[connection monitor](../../apps/teams/src/client/native-connection-panel.tsx#L37),
[early status routes](../../apps/teams/src/app.ts#L175),
[CLI guidance selection](../../apps/teams/src/server.ts#L139),
[explicit source revalidation tests](../../tests/unit/teams/source-revalidation.test.ts).

## 8. Selective implementation and verification

### Suggested batches

| Batch | Select | Why / stopping point |
| --- | --- | --- |
| A: safest starting point | 00 + 01 + 02 | Establish attribution, eliminate verified duplicate captures, fix misleading loading. Re-measure before selecting more work. |
| B: ordinary navigation and search | 03 + 04; optionally 06 | Reduce repeated logical calls and source captures. Choose based on the actual slow interaction. |
| C: credential and large-source work | 05 + 08 | Requires explicit freshness/identity/throttling design. Do not combine an unbounded parallel-query change with an unvalidated token cache. |
| D: entry/rendering/long-running work | 07 + 09 + 10 + 11 | Select by startup, cancellation, Plays or native CPU evidence; do not assume all are needed. |

Each item can be implemented separately unless its card lists dependencies.
Do not sum the controlled reductions across items: several remove the same work,
so their benefits overlap.

### Validation contract for a selected change

1. Fix the source revision, deployed client/server identity, Live mode and
   authentication profile. Confirm the **page** is in Live mode; a Live backend
   can initially open Sample.
2. Compare the same authorized scope and action. Label first-observed and repeat
   behavior; do not call an uncontrolled run "cold".
3. Record logical operation count, source HTTP count, credential acquisition
   count, bytes, first feedback, first usable content and settled UI separately.
   Use larger repeated samples before reporting percentiles.
4. Re-run deterministic count tests and denial/freshness tests. Required cases:
   concurrent independent captures, CLI subject switch, owner disconnect,
   expired token, source permission change, mode change, membership/visibility
   mutation, stale response and reviewed-write concurrency.
5. Add tests at the changed layer: shared operation/contract/transport parity
   for new reads; component/interaction tests for loading and focus behavior;
   browser journeys for the affected workspaces.
6. Keep admission, role/query policies, quotas, source freshness, strict schema
   validation, approval and audit behavior. Do not return partial pages as
   complete results or retry unknown writes.
7. Run the repository's relevant gates and smokes for the actual implementation.
   This documentation-only assessment did not rebuild, reinstall or restart the
   running applications.

### Architecture and privacy boundaries

Use the existing shared orchestrator and versioned common contracts. Keep
transports thin and shared UI helpers browser-safe. Cache public assets
separately from private data, and scope any approved data cache to the real
principal/environment/mode and generation. No credentials, customer identifiers,
financial values, transcripts or prompt/response text belong in telemetry.

## 9. Platform references and relationship to prior work

- [AzureCliCredential JavaScript reference](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/azureclicredential?view=azure-node-latest):
  documents its use of `az account get-access-token`. The installed SDK's process
  dispatch was also inspected; this is not a measurement of its duration.
- [Teams content pages and native loading indicator](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/create-tab-pages/content-page#show-a-native-loading-indicator):
  SDK readiness/initial loading is separate from business-data readiness.
  Initialization should not wait for an arbitrarily slow full portfolio query.
- [Teams mobile performance practices](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/teams-mobile-best-practices):
  useful general guidance on asset size, caching and initialization measurement.
  It is mobile guidance, **not evidence** of this Windows client's host latency.
- [Existing engineering performance backlog](./03-performance.md) and
  [earlier optimization notes](../performance/performance-optimization.md):
  background only. Parts describe older implementations or an absent Teams
  surface. Current code and the evidence limits above take precedence for this
  assessment.

**Bottom line:** first reduce repeated fresh captures, avoid accidental search
fan-out and show honest loading. Preserve Teams' stronger source/identity
boundaries. Pursue host/rendering and larger caching changes selectively, rather
than attributing every delay to Teams or applying a blanket cache/timeout fix.

## 10. Implementation status

The safe, evidence-backed variants below are implemented across the shared
backend and applicable UI surfaces. The original assessment is not rewritten as
a claim that native/customer-query latency was measured.

| Item | Implemented variant | Preserved boundary / deliberate limit |
| --- | --- | --- |
| TPERF-00 | Opt-in operation, credential, source-read and agent/context timing; async HTTP correlation; technical-field-only serialization | Off by default; no customer/prompt/response/token logging. |
| TPERF-01 | Existing bounded read contexts used by composite snapshot, MCEM, Guidance, catalog and aggregate reads | Independent captures still re-read source; no cross-request authorization/data cache. |
| TPERF-02 | Portfolio loading covers the whole capture; explicit retry/error versus empty states; shared New account loading/error/retry; Guidance pipeline status | No invented progress percentage or successful fallback after denial. |
| TPERF-03 | Teams search is local on focus and sends one debounced aggregate read for a query of at least two characters | Every fresh query is authorized; mode/view/disconnect clears its index. |
| TPERF-04 | Versioned aggregate index/workspace reads exposed through Teams HTTP, Web HTTP, Desktop IPC and extension bridge | Shared-core operation semantics, strict schemas and unchanged selection/scope denial. |
| TPERF-05 | Same-generation concurrent CLI acquisition is coalesced | Sequential dispatches still reacquire/revalidate; no expiry-only Desktop token policy copied into Teams. |
| TPERF-06 | Identical pending reads coalesce per client with independent subscribers; stable loading area and memoized filters/sort | Live revisits continue fresh validation. No new stale-while-revalidate display or TTL. |
| TPERF-07 | Immutable caching only for public content-hashed assets | HTML, build/config/session/private APIs stay `no-store`; pairing and build identity unchanged. |
| TPERF-08 | Deterministically ordered source chunks run with a maximum concurrency of two | Same scoped query/fields/paging and complete result shape. New server-side filtering/pagination is not introduced. |
| TPERF-09 | Cancelled Teams read requests and aggregate Web reads pass cancellation into source dispatch and pagination | Fresh captures own pending identity/evidence promises; one cancellation cannot poison another. Submitted workflows/writes are not cancelled by navigation. |
| TPERF-10 | Plays uses completion-spaced adaptive polling and pauses it when hidden | Every disclosed result still performs current source-scope verification. No unchecked progress/output endpoint added. |
| TPERF-11 | Lazy Teams workspace chunks with explicit failure recovery; on-demand MCEM board; memoized list projections in Teams/Desktop/Web/extension | Draft, focus and accessibility behavior retained. No speculative table virtualization or blanket form unmounting. |

### Cross-surface improvements

- Snapshot, MCEM, Guidance and creation-catalog coalescing lives in the shared
  orchestrator, not in a Teams-only fork.
- Desktop/Web portfolio refresh and search-index construction use one aggregate
  read instead of per-account transport fan-out.
- The extension's Plays name index uses the same aggregate operation rather than
  sending one bridge call per account.
- Desktop/Web/extension Discovery projections are memoized. Shared New account
  loading and retry behavior is consistent on all consumers.
- Web's documented **per-request** runtime/user isolation is retained. This change
  does not add a cross-request runtime/token cache or copy another user's state.

### Verified mechanism and remaining evidence boundary

The new deterministic Live-connector regression asserts **one portfolio scan and
seven source/token-provider calls** for a complete selected workspace and for a
snapshot in the original one-account/no-milestone fixture. These replace the
assessment's separate-read **17** and snapshot **11** baselines. Concurrent
captures remain independent; denial and cancellation are tested explicitly.
Chunk concurrency is tested at exactly two with deterministic final ordering.

The new browser checks assert one aggregate Portfolio operation, zero search
requests on focus/refocus, one index request after typing, explicit denial/retry
without stale success, and usable navigation after a failed lazy workspace load.
All-four-transport tests compare schema-validated aggregate outputs.

No further Live source/model calls were made for implementation validation.
Native Teams latency, tenant source timings and production percentage speedups
remain unmeasured. Tests use canonical sanitized Sample data for UI journeys and
the actual Live classes with injected deterministic sources for backend counts.

### Final validation record

| Gate | Result |
| --- | --- |
| `npm run validate:major` | Passed: strict typecheck; 198 test files, 1,270 tests passed and 15 opt-in tests skipped; Desktop build and desktop smoke passed. |
| `npm run test:smoke:teams` | Passed: all 67 Teams browser journeys, including aggregate request counts, loading, source denial, lazy-load recovery, pairing and mode isolation. |
| `npm run test:smoke:revamp` | Passed: all 110 Desktop/Web/extension journeys, including actual native Desktop and native VS Code offline-voice coverage. |
| `npm run web:build` | Passed: shared renderer and Web host. Desktop and extension builds also passed in the revamp gate; Teams built in its smoke gate. |
| `npm run lint -- --ignore-pattern .venv` | Passed: application and test source lint. |
| Raw `npm run phase0:check` | Structure and Sample preflight passed; blocked by two pre-existing `no-undef` errors in pip-vendored `.venv` JavaScript. Vendored files were not changed. |

The successful revamp run selected the already-installed VS Code Insiders runtime:

```powershell
$env:TLC_VSCODE_EXECUTABLE = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code Insiders\Code - Insiders.exe'
npm run test:smoke:revamp
```

The installed Stable VS Code's isolated extension-test bootstrap did not create
its test bridge in this environment. The same native journey passed with
Insiders, and the full 110-test suite then passed with that runtime; the native
test was not skipped or weakened.

The final built Teams entry and its two eagerly preloaded shared JS assets total
**1,065,010 raw bytes**, compared with **1,135,758** in the assessed deployment.
Four workspace bundles load on demand; there are seven JS assets overall.
The initial raw-JS reduction is **70,748 bytes**. This is an artifact measurement,
not a claimed native latency improvement; total bundle bytes and transferred/
compressed bytes are different measurements.

Implementation changes remain uncommitted. Generated tracked build/cache outputs
are excluded from the source change. The operator's existing Live process,
installation, source connection and tenant permissions were not changed.

## 11. Shared-backend follow-up and performance measurements

This follow-up explicitly changes the backends, not only presentation or loading
indicators. It keeps one shared orchestrator and connector layer for all four
surfaces. No production service was restarted and no tenant/model calls were
used for the measurements below.

### Additional backend changes

| Backend area | Change | Verification |
| --- | --- | --- |
| Shared portfolio index | The orchestrator can obtain one bulk connector result instead of filtering/cloning the loaded portfolio once per account. Live indexing groups opportunities in a single pass while retaining account and within-account order. | Exact output parity and zero per-account connector calls on the optimized path. |
| SQLite opportunity reads | Bulk index query retains the existing current-user Deal Team/milestone-team predicates and visibility filtering. Owners are joined into the query; intent labels are read once, not once per opportunity/code. | Full ordered index uses exactly four SQL queries and no per-record `get()` lookups. Existing owner/intent fields are preserved. |
| SQLite milestones | Owners are joined into the milestone read shared by Portfolio and Discovery. | Two bulk queries plus the existing three access-check lookups for a Portfolio milestone read; no per-milestone owner query. |
| Live milestone memberships | Memberships are reused only within the current read capture, including the no-configured-template case. A new capture rechecks them. | One membership read per capture; a changed membership is reflected in the next capture. Snapshot/workspace fixture now needs six source reads instead of the first pass's seven. |
| Workflow scope captures | Shared scope verification and the applicable Desktop/extension/sample compositions consume the bulk index rather than recreating it through per-account reads. | Workflow source-denial, lifecycle and transport parity regressions pass. |

These changes are in the [shared orchestrator](../../packages/orchestrator/index.ts),
[workflow operation layer](../../packages/orchestrator/operations.ts),
[Live MSX connector](../../packages/connectors/msx/live.ts) and
[SQLite connector](../../packages/connectors/local-store/index.ts).
Existing connector adapters without a bulk method retain the validated fallback.
No wire shape, delegated scope, review gate or global contract version changes.
Web continues to construct a per-request runtime; no user/token cache is shared
between requests.

### End-to-end backend benchmark

Run the new reproducible check:

```powershell
npm run test:perf:backends
```

The [benchmark](../../tests/e2e/backend-performance/hosts.spec.ts) exercises:

- Teams' production HTTP handler and operation dispatch.
- Web's production HTTP handler with a new runtime per request.
- Real Electron IPC using the production preload and aggregate IPC handlers in
  an isolated Electron process/profile.
- The production extension request envelopes, browser `postMessage` bridge and
  host router. The test uses a browser-to-test-host RPC connection, not a timed
  native VS Code extension-host process.

All four use the actual Live MSX connector and shared orchestrator against a
read-only loopback Dataverse fixture: **three accounts, nine opportunities and a
fixed 40 ms delay per source HTTP read**. Every measured case starts with a new
connector; the browser/native process stays running. The existing cache behavior
is retained within each host's sequence. Three trials alternate the order of
baseline/aggregate cases to reduce ordering bias.

The baseline here is the **separate-call operation sequence on the current
backend**, not a checkout of an older release. Each comparison asserts identical
schema-valid data, exact logical/source/token-provider call counts, zero source
writes, and a lower median workspace round-trip time for the aggregate variant.

#### Selected-workspace results

| Host | Separate-call median | Aggregate median | Source/token-provider calls | Host operation calls |
| --- | --- | --- | --- | --- |
| Teams | 793 ms | 307 ms | 16 -> 6 | 3 -> 1 |
| Web | 838 ms | 298 ms | 17 -> 6 | 3 -> 1 |
| Desktop | 441 ms | 353 ms | 7 -> 6 | 3 -> 1 |
| VS Code bridge | 344 ms | 296 ms | 7 -> 6 | 3 -> 1 |

**These are controlled protocol/backend measurements, not measured native
Teams/customer-tenant speedups.** Identity admission is injected for the benchmark;
real CLI acquisition, tenant authorization, TLS, model execution, native UI
rendering and cold-process startup are not timed. The token-provider column
counts source-token requests, not real `az` process executions. Do not rank the
four products by their absolute numbers: the transport mechanisms and existing
cache profiles differ.

#### Index, Discovery and guidance checks

| Operation / profile | Separate-call work | Aggregate/current work |
| --- | --- | --- |
| Portfolio index, Teams/Web | Four host calls and twenty source reads | One host call and five source reads |
| Portfolio index, Desktop/extension | Four host calls and five source reads | One host call and five source reads |
| Discovery, each host | Current scoped domain read | One host call and six source reads |
| MCEM, each host | Current explicit evaluation | One host call and six source reads |
| Deterministic account-pulse Guidance, each host | Current grounded pipeline | One host call and six source reads; no model/network invocation |

For the cache-reusing Desktop/extension index, the small fixture did **not** show
a consistent index-latency improvement despite fewer transport calls. The proven
benefits there are less dispatch/filter/clone work and the bulk SQLite path;
the source count was already five. This is not reported as a universal speedup.
Discovery/MCEM/Guidance checks establish current backend work and successful
complete responses, not a before/after model-latency claim.

The backend reduction is available to every consumer of these shared operations.
The benchmark compares operation paths; it does not claim every existing UI
screen has been rewritten to issue the aggregate workspace operation. The full
UI journeys below separately validate the real current screen wiring.

### Follow-up validation

| Gate | Result |
| --- | --- |
| `npm run test:perf:backends` | Four host performance cases passed, including real Electron IPC and production extension protocol routing; identical results and zero source writes asserted. |
| `npm run validate:major` | Passed: 199 files, 1,274 tests passed and 15 opt-in tests skipped; strict typecheck, Desktop build and desktop smoke passed. |
| Teams UI regression | All 67 browser journeys passed after the backend changes. |
| Desktop/Web/extension UI regression | All 110 journeys passed after the backend changes, with native VS Code coverage using the installed Insiders runtime. |
| `npm run web:build` | Updated Web host and shared renderer built successfully. Teams/Desktop/extension builds passed in their respective gates. |
| Source lint and whitespace | Passed. The previously documented pip-vendored `.venv` errors remain outside the source change. |

The benchmark produces timing-only JSON attachments under
`test-results/backend-performance-runs`; subsequent test runs may replace them.
Its [fixtures and build setup](../../tests/fixtures/performance/backend.ts) and
[Playwright configuration](../../playwright.performance.config.ts) are retained
as source files, so the check can be reproduced rather than relying on these
one-run medians. All implementation changes remain uncommitted for review.
