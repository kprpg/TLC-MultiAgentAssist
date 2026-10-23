# Performance and Speed Roadmap (all layers)

A whole-stack review of where time and resources go in TLC MultiAgent Assist and what to change, ranked. Covers the UI, the transport/IPC hosts, the orchestration layer, MSX/Dataverse/SQLite queries, the agentic (Foundry) calls, and build/packaging/CI/observability, on all four surfaces: Desktop, Web, VS Code, Teams.

This document builds on, and does not repeat, earlier work: [Agentic-Performance.md](./Agentic-Performance.md) (streaming, instant draft, first-token timeout, concurrent MSX reads, pre-warm), [performance-optimization.md](./performance-optimization.md) (shared Foundry client, source caches, adaptive freshness), and [03-performance.md](../engineering/03-performance.md) (PERF-1..6 backlog).

## 1. How to read this document

**Evidence levels.** Every finding carries one:

| Mark | Meaning |
| ---- | ------- |
| **M** | Measured in this review (numbers in section 3). |
| **V** | Verified by reading the code while writing this document. |
| **R** | Reported by a layer analyst from reading the code; plausible and specific but **not independently re-read**. Re-verify before implementing. |

**No improvement percentages are claimed.** Sizes are measured; request counts come from the code; any latency or token effect is labelled *estimate*. Section 11 defines how to baseline and prove each change.

**Line numbers** are from the working tree on branch `feature/vscode-extension-Teams` (base `c386b21` plus the agent evidence-pack work). Re-locate by symbol if they have drifted.

**Impact / Effort / Risk** use S, M, L. "Surfaces" names the affected hosts.

## 2. Executive summary

The biggest single finding is a correction of an earlier assumption: **the model call is dominated by output length, not by reasoning or first-token delay.** Measured on the deployed v3 agents, time to first token is about 1 to 2.5 s and no reasoning tokens are spent, but each answer is about 1,500 output tokens and takes about 18 to 22 s to stream. Cutting answer length is the largest lever on that segment, followed by everything that makes the user wait *before* the model starts (MSX context reads, new in this release: the deep evidence read) and *after* it (UI re-render of the whole response on each streamed token).

Top ten, in recommended order:

| # | Change | Layer | Impact | Effort | Risk | Evidence |
| - | ------ | ----- | ------ | ------ | ---- | -------- |
| 1 | Shorten the agent output contract (target 450 to 600 words, fewer sections, cap tables); set a per-capability `max_output_tokens`. | Agentic | L | S | M quality | **M** (AG-1) |
| 2 | Coalesce streamed UI updates (one render per animation frame) and stop re-formatting and re-parsing the whole Markdown on every delta. | UI | L | M | M | **V** (UI-1) |
| 3 | Make the model input prompt-cache-friendly: stable content first, volatile `request.prompt` and timestamps last; serialize the pack once. | Agentic/Orch | M | S | L | **M** (AG-2) |
| 4 | Retry with backoff and `Retry-After` on MSX 429/503 (the header is already parsed and discarded). | Queries | M | S | L | **V** (Q-1) |
| 5 | HTTP response compression and conditional/immutable caching for the Web host. | Transport | L | S | L | **V** (TR-1) |
| 6 | Remove the duplicate test run from CI; stop tracking `tsconfig.tsbuildinfo`. | Build | M | S | L | **V** (BS-1, BS-2) |
| 7 | Cut MSX round trips on the agent and portfolio paths: configure the Milestone Team template id, fold the author-name lookup, `in` filters, narrower annotations. | Queries | L | M | M | **V** (Q-2..Q-5) |
| 8 | Lazy-load heavy renderer surfaces and ship the 39 MB voice model on demand instead of inside the installer. | UI/Build | L | M | M | **V** (UI-5, BS-3) |
| 9 | Single-flight identical concurrent agent requests and pass the abort signal through context preparation (keeps the "agent reads are fresh" rule). | Orch | M | M | M | **V** (OR-1, OR-2, AG-7) |
| 10 | Collapse duplicate Zod validation and send projections instead of full workspace graphs over IPC/HTTP/postMessage. | Transport | M to L | M to L | M | **R** (TR-3, TR-4) |

Quick wins (all S effort, low risk): items 3, 4, 5, 6, plus the SQLite indexes (Q-12), the catalog metadata cache (Q-8), the account-search readiness cache (Q-9), `$top` on discovery (Q-6), and the first-token timeout (AG-4, section 9).

## 3. Measurements taken for this review

### 3.1 Hosted agents (M)

Deployed `tlc-risk-solution-play` and `tlc-account-pulse` at **v3** (project `multiagentacctteam`), streaming `responses.create` with `agent_reference`, one realistic synthetic evidence payload (**43,353 characters**, about **10.4k input tokens**: 1 opportunity, 8 milestones, 12 + 12 opportunity entries, 8 x 8 milestone entries), from the developer workstation, sequential, two runs per agent.

| Agent | Run | Headers | First token | Total | Input tokens (cached) | Output tokens | Reasoning tokens |
| ----- | --- | ------- | ----------- | ----- | --------------------- | ------------- | ---------------- |
| risk-solution-play | 1 | 2.4 s | 2.5 s | 22.4 s | 10,510 (0) | 1,591 | 0 |
| risk-solution-play | 2 (same input) | 0.9 s | 1.0 s | 18.1 s | 10,510 (**10,368**) | 1,485 | 0 |
| account-pulse | 1 | 1.2 s | 1.3 s | 19.4 s | 10,422 (0) | 1,482 | 0 |
| account-pulse | 2 (same input) | 0.8 s | 0.9 s | 18.2 s | 10,422 (**10,240**) | 1,510 | 0 |

Reading:

- Generation runs at roughly **80 output tokens per second** after the first token, so total time is almost exactly `output tokens / 80`. **About 17 to 20 s of every call is output streaming.**
- **Reasoning tokens were 0** for these prompts, so "reasoning effort" is not the lever the earlier analysis assumed (Agentic-Performance.md section 2, row 2).
- **Prompt caching works for the agent path**: an identical second call served 98.6% of input from cache and first token fell from 1.3 to 2.5 s to 0.9 to 1.0 s. It only helps when the leading input tokens match.
- Time to first token (about 1 to 2.5 s) is far below the 60 s first-token timeout, so that timeout and its retry are only a worst-case guard.

Limits: n = 4, one payload shape, one network location, no concurrent load, a synthetic payload. Treat as an order-of-magnitude baseline and repeat in the app with `TLC_PERFORMANCE=1` (section 11).

### 3.2 Artifact sizes (M)

| Artifact | Size | Note |
| -------- | ---- | ---- |
| Desktop installer `.exe` / `.zip` | 169 MB / 222 MB | Of which `dist/revamp` is 44.6 MB |
| `dist/revamp/voice/vosk-model-small-en-us-0.15.tar.gz` | **39.3 MB** | Shipped inside the app for voice input |
| `dist/revamp/voice/vosk-worker.js` | 4.1 MB | |
| Revamp renderer `main-*.js` / CSS | **1.1 MB** / 75 KB | Single entry, no route splitting |
| Legacy renderer `dist/renderer` | 0.8 MB | Packaged next to revamp |
| VS Code extension `dist` / `.vsix` | 15.3 MB / 1.1 MB | Webview bundle about 711 KB (R) |
| Web `dist` / Teams `dist` | 0.7 MB / 9.5 MB | Web static `index-*.js` about 1.0 MB plus a 5.7 MB source map |
| `release/` | 7.9 GB, 1,635 files | Local, gitignored build output (accumulated builds); not shipped |
| `release-teams/` | 586 MB, **51,214 files** | Gitignored; file count drives Windows AV and extraction cost |

### 3.3 MSX request counts per journey (V from `live.ts`)

`C(x) = ceil(x / 40)` because ID lists are sent as 40-ID `or` filters, two chunks concurrent.

| Journey | HTTP requests | Sequential depth |
| ------- | ------------- | ---------------- |
| Cold portfolio load | `4 + C(milestones) + C(opportunities) + C(accounts)` plus continuation pages | 4 waves; Milestone Team discovery is internally serial (template, user, teams, milestone lookup) |
| Agent click (this release) | portfolio load (fresh read context) + milestone rows + evidence wave (about 8 parallel reads plus `C(M)` task chunks) + author-name lookup `C(U)` + MCEM guidance for two stages | portfolio waves, then milestone rows, then evidence wave, then author lookup: **about 7 waves** |
| Discovery snapshot | `C(accounts)` queries, giant `or` filter each, serial paging | `ceil(C(A)/2)` plus pages |
| Record-creation catalog | **about 12 requests, uncached, on every open** (user, price lists, currencies, workloads, opportunities, 7 choice-metadata reads) | 1 wave after account/user |
| Meeting apply | validate + PATCH + reload per changed milestone, sequential | `N x 3` |

## 4. Where the time goes: the two critical paths

**Agent click (Desktop/Web/VS Code/Teams share this).** Estimated, then to be baselined:

```text
click
 -> transport hop                                  ms        (IPC / HTTP / postMessage / Teams)
 -> request validation (1-3x)                      ms
 -> MSX context (fresh):  portfolio 4 waves
                          milestones + evidence    ~2-3 waves, author lookup 1 wave        ~1-3 s   (estimate: ~7 sequential OData waves)
 -> MCEM guidance (PDF memoized)                   ms, parallel
 -> instant deterministic draft shown              <- user sees something here
 -> Foundry:  first token ~1-2.5 s, then ~80 tok/s x ~1,500 tok            ~18-22 s   (measured)
 -> UI: whole-response Markdown re-parse per delta                          CPU, grows with length
```

**Cold start / first paint.** Process start, eager module load (Azure identity, Foundry SDK, PDF, SQLite, large `live.ts`), portfolio hydrate, then a 1.1 MB single-entry renderer bundle parsed before first paint.

## 5. UI layer (Desktop and Web share `renderer-revamp`; VS Code webview and Teams client are separate)

| ID | Finding | Where | Evidence | Proposed fix | Impact | Effort | Risk / surfaces |
| -- | ------- | ----- | -------- | ------------ | ------ | ------ | --------------- |
| UI-1 | Every streamed delta re-formats and re-parses the **whole** response (`formatResponseMarkdown` does split/map/regex/join over every line, then `react-markdown` rebuilds the tree). Cost grows with answer length, and answers are now table-heavy. | `apps/shared/agent-response.tsx` (render), `apps/shared/response-markdown.ts`, `apps/shared/use-agent-run.ts` | **V** | Buffer deltas and flush once per `requestAnimationFrame` (or 50 ms); memoize the formatted string on `content`; render finished blocks as stable memoized children and only re-parse the trailing open block; skip the heading/label formatter until the stream completes. | L | M | M; all four surfaces (shared code) |
| UI-2 | `setAgentPhase` and `setAgentResult` are two separate state updates per progress event. | `use-agent-run.ts` | **V** | One state object (or `useReducer`) updated from a rAF-coalesced ref. | M | S | M; shared |
| UI-3 | Stage board runs one `runMcemCoach` per opportunity in a single `Promise.all` and waits for all before showing. | `renderer-revamp/src/App.tsx` (stage board load) | **V** | Evaluate visible/selected cards first with a concurrency cap of 3 to 4, fill progressively; longer term a batch/board operation that reuses one portfolio read. | L | M to L | M; Desktop/Web |
| UI-4 | One oversized `App.tsx` owns 50+ `useState` hooks (accounts, discovery, activities, board, workflows, dialogs, drag, agent). Any update re-renders the shell. | `renderer-revamp/src/App.tsx` | **R** (consistent with repo rule UI-1 in `02-ui-layout.md`) | Split into workspace components with local state; memoize leaves; keep derived arrays in `useMemo`. Land as focused components per the architecture rules. | L | L | M; Desktop/Web, same for VS Code `webview/app.tsx` |
| UI-5 | Single 1.1 MB entry bundle; no code splitting. The VS Code webview is one 711 KB IIFE. | `apps/desktop/vite.revamp.config.ts`, `apps/vscode-extension/vite.webview.config.ts` | **V** (size), **R** (config) | Dynamic-import discovery, workflows, dashboard, record creation, voice, and Markdown; manual vendor chunk for React/Fluent; report gzip/brotli size in CI. (Teams already splits `activity`, `meetings`, `workflows`.) | L | M | M; keep VS Code CSP/nonce |
| UI-6 | Derived collections and callbacks recomputed in render (`useMemo`/`useCallback` missing for workflow persona/source filters and discover milestone view). | `App.tsx` around the workflow and discovery blocks | **R** | Memoize with precise deps. | M | S | L |
| UI-7 | Large lists are paginated but not virtualized; discovery filters and sorts the full set per render. | `apps/shared/seller-dashboard-table.tsx`, `vscode-extension/.../app.tsx` | **R** | Window long lists; push filter/sort server-side for big portfolios; memoize sorted data. | M | M | M |
| UI-8 | Teams launch status polls `/api/teams/launch` every 10 s even when connected, and its effect restarts on identity changes. | `apps/teams/src/client/launch-status.tsx` | **R** | Back off or stop once stable; depend on primitive ids. | S | S | L; Teams |

Verified fine: subscription/listener cleanup, session-cache batching, abort on selection change, request-generation guards (`presentation-hooks.ts`, `session-cache.ts`, `App.tsx` selection handling).

## 6. Transport / IPC / host layer

Hops per path (all marshal only, per the architecture rules): Desktop `renderer -> ipcRenderer.invoke -> ipcMain.handle -> request parse -> orchestrator -> response parse -> structured clone`; Web `HTTP body parse -> auth -> createRuntime -> request parse -> orchestrator -> response parse -> JSON.stringify`; VS Code `postMessage envelope parse -> params parse -> provider -> response parse -> postMessage`; Teams `HTTP -> auth + lifecycle + budget -> per-request service graph -> operation parse -> orchestrator`.

| ID | Finding | Where | Evidence | Proposed fix | Impact | Effort | Risk / surfaces |
| -- | ------- | ----- | -------- | ------------ | ------ | ------ | --------------- |
| TR-1 | **No response compression** for JSON or static assets on Web/Teams. Portfolio/workspace and agent payloads and a 1 MB JS bundle go out uncompressed. | `apps/web/src/app.ts` (JSON writer), `apps/web/src/hosting.ts` | **V** (no gzip/brotli/zlib/content-encoding in `apps/web/src`, `apps/teams/src`) | Brotli/gzip with a size threshold and `Vary: Accept-Encoding`; pre-compress immutable assets at build; or enable App Service/front-door compression. Typically 60 to 90% fewer bytes for JSON and JS (estimate). | L | S | L; Web/Teams |
| TR-2 | Static files are `stat`'ed then `readFile`'d on every request, with no ETag or conditional GET. | `apps/web/src/hosting.ts` | **V** | Cache immutable asset buffers and metadata in memory (keep `no-store` for `index.html`), add ETag + 304. | M | S | L; Web |
| TR-3 | Payload validated repeatedly: renderer/preload/main parse, `operation()` input parse, response parse in each transport. | `packages/orchestrator/operations.ts`, `apps/web/src/app.ts`, `apps/desktop/electron/main/portfolio-ipc.ts`, `vscode-extension/src/host-router.ts` | **R** | One validation boundary per host (trusted internal path skips re-parse); keep untrusted-input parsing at the edge, which is a security requirement. Measure parse time per operation first. | M | M | M; all hosts, security-sensitive: do not remove edge validation |
| TR-4 | Full workspace graph (accounts, opportunities, milestones) is serialized, cloned, validated and rendered even when the UI needs a subset. | `portfolio-ipc.ts`, `web/src/app.ts`, `host-router.ts` | **R** | `includeMilestones`/field projection and paging on `getPortfolioWorkspace`; summary vs detail contracts (version bump per Rule 1). | L | L | M; all clients |
| TR-5 | Teams rebuilds the service graph and operation catalog on every request. | `apps/teams/src/app.ts` | **R** | Cache immutable adapters per configuration generation; keep principal-bound state request-scoped. | M | M | M; Teams authorization isolation |
| TR-6 | VS Code providers without `runAgentTaskStream` emit one large `complete` message; Teams reviewed actions re-read sources several times. | `vscode-extension/src/host-router.ts`, `teams/src/app.ts` | **R** | Require streaming in live mode; carry the authorized snapshot through execution instead of re-reading. | M | M | M |
| TR-7 | Auth token caching: Desktop caches until 5 min before expiry (OK). Web holds a token per-principal runtime; concurrent first requests can each acquire. | `azure-cli-token-provider.ts`, `web/src/runtime.ts` | **R** | Process-scope, promise-coalescing token cache keyed by tenant/principal with skew. | M | M | M; identity isolation |
| TR-8 | Synchronous `JSON.stringify` of very large payloads blocks the event loop. | `web/src/app.ts` | **R** | Fix by shrinking payloads (TR-4) first; measure event-loop delay before adding workers. | M | M | M |

## 7. Orchestration layer

| ID | Finding | Where | Evidence | Proposed fix | Impact | Effort | Risk / surfaces |
| -- | ------- | ----- | -------- | ------------ | ------ | ------ | --------------- |
| OR-1 | Every agent click re-reads context from scratch (fresh read context): portfolio, milestones, evidence, two guidance stages. A double click or two surfaces on the same opportunity repeat it. | `packages/orchestrator/index.ts` (`prepareAgentTask`, `runAgentTask*`) | **V** | **Single-flight** keyed by (user scope, opportunity id): concurrent identical context reads share one in-flight promise and are discarded on completion. No TTL cache, so the "agent reads are fresh" rule is unchanged. A short TTL keyed by `modifiedon` is a separate, riskier option (section 12). | M | M | M; must never share across users or delegated scopes |
| OR-2 | Cancellation is only checked after all context reads finish. | `index.ts` `prepareAgentTask`, `agent-evidence.ts` | **V** | Thread the `AbortSignal` through `prepareAgentTask`, `collectOpportunityEvidence`, guidance reads. | M | M | L |
| OR-3 | Composite workflows run connector steps **sequentially**; every composite definition is `dataverse-mcp read_query` (required) then `msx-mcp` (optional). Result is assembled and `structuredClone`d after every step and again at the end. | `workflows/runtime.ts` (step loop and result assembly), `workflows/cohort.ts` (plans) | **V** | Run independent steps with `Promise.allSettled` keeping per-step timeout, cancellation and required-step semantics; assemble and clone once at completion unless intermediate results are a documented contract. Benefit is real only where the optional `msx-mcp` step is enabled (it is feature-flagged). | M | M | M; cancellation and ordering |
| OR-4 | `buildAgentEvidencePack` serializes the pack up to 5 times to enforce the budget and re-sorts every history per tier. | `packages/orchestrator/agent-evidence.ts` | **V** (my code) | Sort once per source, then cap per tier; serialize once and keep the length; add bytes and estimated tokens to telemetry. | S | S | L |
| OR-5 | Evidence fallback (connectors without a deep read: sample fixture, local store) fans out up to 25 `listMilestoneActivities` calls at once. | `agent-evidence.ts` `collectOpportunityEvidence` | **V** | Bounded pool (4 to 6). Does **not** affect live (the live connector has a native deep read). | S | S | L |
| OR-6 | Workflow run history and result retention: `structuredClone` on `set/get/list`; result payloads retained until run eviction (capacity 100). | `progress/run-history.ts`, `workflows/runtime.ts` | **R** | Clone only at API boundary; bound result bytes/TTL. | M | M | M |
| OR-7 | Mutation journal `pending()` reads active entries serially (up to 100). | `mutations/journal.ts` | **R** | Bounded concurrent reads or a batch read. | M | S | M |

Verified fine: milestone, guidance and evidence reads already overlap; workflow schemas are built at module scope; reconciliation uses a `Map`; cohort executor makes no agent calls per item (keep it that way, or batch if enrichment is added).

## 8. Data and query layer (MSX Dataverse OData, Dataverse MCP, SQLite)

| ID | Finding | Where | Evidence | Proposed fix | Impact | Effort | Risk / surfaces |
| -- | ------- | ----- | -------- | ------------ | ------ | ------ | --------------- |
| Q-1 | **429/503 are not retried.** `Retry-After` is parsed into `MsxRequestError.retryAfterMs` but no code retries; a throttled call fails the whole journey. | `packages/connectors/msx/live.ts` `requestJson` | **V** | Central bounded retry (2 to 3 attempts, exponential backoff with jitter, honour `Retry-After`, respect the read-context abort signal) for idempotent GETs only. Reliability is speed here: a failed agent context currently forces a full re-run. | M | S | L; never retry writes |
| Q-2 | Milestone Team discovery is a hidden serial chain inside the "parallel" portfolio wave: resolve template, get user id, read teams, then look up milestone parents. | `live.ts` `readMilestoneTeamMemberships`, `resolveMilestoneTeamTemplateId`, `milestoneTeamOpportunityIds` | **V** | Set the template id in configuration (already supported, skips discovery); cache user id and template per process; a single server-side relationship query or FetchXML join for milestone-to-opportunity. Saves 2 to 3 round trips on every cold portfolio load. | L | S to M | M; privileges |
| Q-3 | ID lookups use `idField eq id1 or ... or id40` filters. Long URLs, slower server parse, risk of 400/414 on larger lists. | `live.ts` `requestByIds`, `collectChunks` | **V** | OData `in` / `Microsoft.Dynamics.CRM.In` if the environment supports it; otherwise `$batch` GETs. Confirm against the Dataverse MCP query-guard allowlists first. | M | M | M |
| Q-4 | Every GET asks for `FormattedValue` annotations, including ID-only and raw-value reads, which inflates payload and parse time. | `live.ts` `requestJson` `Prefer` header | **V** | Make annotations opt-in per call; keep for reads that map labels. | M | S to M | L (mapping relies on labels in some reads; snapshot-test) |
| Q-5 | Agent evidence (new): two `opportunities(id)` GETs (details and history) and a post-hoc author lookup add a wave. | `live.ts` `getOpportunityEvidence` | **V** (my code) | Merge details and history into one `$select` (keep the optional-column fallback); cache `systemuser` names per process with a TTL and fetch only misses, or `$expand` where allowed. | M | S | L |
| Q-6 | Discovery selects many columns with no explicit `$top`, and filters by account and domain only. | `live.ts` discovery query | **R** | Narrow `$select` to mapped fields, bound `$top`, add server-side state/date predicates. | M | S | L; preserve semantics |
| Q-7 | `requestAll` follows `@odata.nextLink` serially. | `live.ts` `requestAll` | **V** | Prefer narrower server-side filters and bounded results. Do not parallelize opaque `nextLink`s. | M where paging occurs | M | M |
| Q-8 | Record-creation catalog does about 12 requests, uncached, on every open (price lists, currencies, workloads, 7 choice-metadata reads). These change rarely. | `live.ts` `getCatalog` | **V** | Per-process TTL cache (for example 1 hour) for metadata and reference lists, keyed by environment; keep opportunities and owner fresh. | L (on repeat opens) | S | L (stale labels within TTL) |
| Q-9 | Account search spends a request on index-readiness every time. | `connectors/msx/account-search.ts` | **R** | Cache "index ready" for a short TTL; exact/TPID path first. | M | S | L |
| Q-10 | Meeting capture: proposal reads context and milestones separately, apply is N sequential validate/PATCH/reload cycles. | `live-meeting.ts`, `live.ts` `updateMilestone` | **R** | A combined meeting-context read; bounded-concurrency or `$batch` PATCHes, keeping per-record concurrency tokens and the compensation path. | L | L | M; write semantics |
| Q-11 | Dataverse MCP `read_query` is capped at 20 rows: 100 rows is 5 serial keyset round trips; the query guard re-parses the entity map per call. | `dataverse-mcp/adapter.ts`, `query-guard.ts` | **R** | Compile and cache the entity map at adapter construction; raise or batch the cap only if the MCP contract allows. | M | M | M; delegated scope |
| Q-12 | Local SQLite store: only primary keys (no secondary indexes), a new `prepare` on every operation and per seed row, and `SELECT *` in catalog reads. | `connectors/local-store/schema.ts`, `local-store.ts`, `index.ts`, `record-creation.ts` | **R** | Indexes on `engagement_milestone(opportunity_id)`, `milestone_activity(milestone_id, created_on)`, `opportunity(account_id)`, team FKs; prepared-statement cache; one prepared insert per table in the seed transaction; explicit column lists. Verify with `EXPLAIN QUERY PLAN`. | M to L (local store size) | S | L |

Not a real problem: `listMilestoneActivities` is **not** an N+1 in the UIs. Both call it on demand for the one selected milestone (`renderer-revamp/src/App.tsx`, `webview/app.tsx`). It only multiplies in the evidence fallback (OR-5), already bounded.

## 9. Agentic / Foundry layer

| ID | Finding | Where | Evidence | Proposed fix | Impact | Effort | Risk |
| -- | ------- | ----- | -------- | ------------ | ------ | ------ | ---- |
| AG-1 | **Output length is the dominant model cost.** About 1,500 output tokens at about 80 tok/s is about 18 to 20 s, even though the target in the instructions is 500 to 700 words. v3 mandates 8 to 11 sections with tables. | `packages/agents/*/prompts/instructions.md`, `foundry-agent.json` | **M** | Tighten the contract: lead with Summary and ranked actions; fold Context used, Sources and Assumptions into compact lists; cap tables at 5 rows; ask for 350 to 500 words for Account Pulse and MCEM Coach, allow more only for Pursuit plans and explicit requests. Set `maxOutputTokens` per capability with headroom. Re-run golden scenarios and the Foundry evaluation suites. Estimated effect: halving output tokens roughly halves generation time (to about 9 to 11 s). | **L** | S | M quality; redeploy agents |
| AG-2 | Volatile content leads the model input (`request.prompt` first, `generatedAt` inside the pack), so the stable prefix cannot be reused across prompts or opportunities. Measured: identical input gets 98.6% cache hits and a first token 0.4 to 1.5 s faster. | `agent-evidence.ts` `serializeAgentContext`, `buildAgentEvidencePack` | **M** + **V** | Order stable-to-volatile: `guidance`, `nextStageGuidance`, then opportunity/evidence, then `localEvaluation`, then `request.prompt` last; drop `generatedAt` and empty fields from the model input; keep key order deterministic. Only gains when two calls share a long leading run (same opportunity, different prompt or capability). Confirm with `input_tokens_details.cached_tokens`. | M | S | L |
| AG-3 | Input is about 10k tokens for a 43 KB pack; `localEvaluation` repeats criteria and rationale already in `guidance` and observations. | `index.ts`, `agent-evidence.ts` | **V** | Send compact normalized evaluation facts (criterion id, status, one-line rationale) and drop duplicated rationale text. Lower input tokens, lower cost, slightly lower TTFT. | M | M | M grounding; run goldens |
| AG-4 | First-token timeout is 60 s with one retry, so a stalled first attempt costs up to about 120 s. Measured first token was 1 to 2.5 s. | `connectors/foundry/index.ts` | **V** + **M** | After the baseline (section 11), lower `firstTokenTimeoutMs` to about 15 to 20 s (p95 plus margin); do not retry once any event has arrived; keep one retry for no-event stalls. | M (worst case) | S | M false timeouts; config only |
| AG-5 | `runAgentTask` (non-streaming) still blocks for the whole generation. | `index.ts`, `foundry/index.ts` | **V** | Prefer the streaming operation wherever the surface supports it; keep blocking only as a compatibility path. | L (perceived) | M | L |
| AG-6 | Follow-ups re-send the entire previous answer (up to 64,000 characters). | `apps/shared/agent-follow-up.ts` | **V** | Use `previous_response_id` chaining if `agent_reference` supports it (**unverified**: test before relying on it); else send a compact structured summary of the prior answer plus its cited refs. | M | M | M; response ids must be user- and opportunity-bound |
| AG-7 | Identical concurrent clicks start duplicate model calls. | `index.ts` | **V** | Single-flight on (capability, opportunity, prompt hash, instruction version) with caller-owned cancellation; no result cache beyond the in-flight window. | M | M | M |
| AG-8 | A **content-filter (jailbreak) rejection** on seller comments fails the whole request after the context cost has been paid, then falls back to the local draft. | `foundry/index.ts`, `index.ts` | **M** (observed) | Detect the `content_filter` error; retry once with comment/note text redacted (keep refs, ages, statuses) and label the answer partial. Low-latency path to a model answer instead of the local draft. | M (affected requests) | M | M; disclose redaction in the answer |
| AG-9 | No metric separates evidence build time, input size, cached tokens, retries, or cancellation phase. | `index.ts`, `foundry/index.ts` | **V** | Add privacy-safe metrics: `agent.context.evidence` exists; add pack bytes, estimated input tokens, `cachedTokens`, time to first event, retry count, finish reason. Never log content or ids. | M (enabler) | S | L |
| AG-10 | Model right-sizing: Account Pulse and quick triage could use a smaller or non-reasoning deployment. | Foundry project | **R** | The measurement shows 0 reasoning tokens already, so a smaller model mainly reduces per-token latency and cost. Evaluate against the golden scenarios and eval suites before switching; the agent definition is in Foundry, so this is a project change plus a manifest change. | M | M | M quality |

Verified fine: instant draft shown before model text; abort propagates into the Foundry stream; serialization already drops raw comments in favor of the pack; streaming telemetry reports TTFT and tokens.

## 10. Build, packaging, startup, CI, observability

| ID | Finding | Where | Evidence | Proposed fix | Impact | Effort | Risk |
| -- | ------- | ----- | -------- | ------------ | ------ | ------ | ---- |
| BS-1 | **CI runs the whole test suite twice**: `phase0:check` runs `npm test`, then a coverage step runs `npm test -- --coverage`. | `.github/workflows/ci.yml` | **V** | Run coverage once (make it the only test invocation) and keep structure/lint/typecheck separate. About one full test run saved per push. | M | S | L |
| BS-2 | `tsconfig.tsbuildinfo` is tracked and changes on every typecheck. | repo root | **V** (it showed as modified in `git status`) | Ignore `*.tsbuildinfo`; remove from the index. | S | S | L |
| BS-3 | The installer ships a **39.3 MB voice model** plus a 4.1 MB worker for an optional feature. The legacy renderer is also packaged next to the revamp one. | `apps/desktop/package.json` `files`, `dist/revamp/voice` | **V** | Download the Vosk model on first use of voice (verify the hash), or ship it in an optional pack; package only the renderer the main process loads (`apps/desktop/electron/main/index.ts` selects one by flag). About 20 to 25% of the installer. | L | M | M offline voice use |
| BS-4 | Coverage emits four reports and uploads the whole directory on every push. | `vitest.config.ts`, `ci.yml` | **R** | Text + JSON by default; HTML/LCOV on schedule. | S | S | L |
| BS-5 | The default Vitest glob also picks up live and integration suites; Playwright runs one worker; CI runs no performance gate. | `vitest.config.ts`, `playwright.*.config.ts` | **R** | Separate scripts per category; shard Playwright; add a nightly performance job with p95 budgets (section 11). | M | S to M | L |
| BS-6 | TypeScript composite/project references are declared in the base config but disabled per project, so `tsc --build` does not exploit the dependency graph; source and declaration maps are always emitted. | `tsconfig.base.json`, per-package tsconfigs | **R** | Real project references or per-package build configs; production configs without maps. | M | M | M |
| BS-7 | Heavy modules load eagerly at start (`@azure/identity`, Foundry SDK, PDF parser, SQLite, the large `live.ts`). The VS Code extension activates on `onStartupFinished` and loads its host eagerly after that. | `apps/web/src/runtime.ts`, `apps/teams/src/*`, `apps/vscode-extension/package.json` | **V** (activation event), **R** (imports) | Dynamic `import()` for identity, Foundry and PDF inside live-mode init; Node compile cache (`module.enableCompileCache`) in the hosts; for VS Code, activate on view/command and defer live provider construction. | M | M | M |
| BS-8 | Web deployment artifact is 240 MB and the web static bundle ships a 5.7 MB source map; Teams package is 51,214 files. | `release-web/`, `release-teams/`, `scripts/package-teams.mjs` | **V** (sizes) | Prune production dependencies, exclude maps from deployed static assets, bundle the Teams runtime into fewer files. Faster deploy, extraction and AV scanning on Windows. | M | M | M |
| BS-9 | No aggregation or budget: telemetry emits events (`TLC_PERFORMANCE=1`) but nothing computes p50/p95 or fails on regressions. | `packages/common/telemetry/performance.ts`, `tests/e2e/backend-performance` | **R** | Section 11. | L (enabler) | M | L |

## 11. Measurement plan and budgets

Do this first. It tells you which of the above matter on your data and proves each change.

**Baseline (one cold launch plus five warm runs per capability, per surface).** Use the same identity, MSX portfolio, network and prompt. Set `TLC_PERFORMANCE=1` (Desktop logs automatically). Record:

| Metric | Source | Provisional target (to be set after baseline) |
| ------ | ------ | --------------------------------------------- |
| Time to instant draft | click to `context` event | p50 under 3 s |
| Agent context phases | `agent.context.msx`, `.milestones`, `.mcem`, `.evidence` | sum p50 under 2 s |
| Time to first model text | click to first `delta` | p50 under 4 s |
| Total agent time | `agent.task.<capability>` | p50 under 12 s (after AG-1), p95 under 25 s |
| Output tokens / cached input tokens | Foundry `usage` | output under 900; cache hit rate tracked |
| MSX requests and depth per journey | add request counters per read context | cold portfolio at most 8 requests, depth 3 |
| UI: commits per streamed delta, long tasks | React Profiler, Performance panel | at most 1 commit per frame during streaming |
| Bundle size | CI report, raw and gzip | renderer entry under 600 KB gzip-equivalent after splitting (set after measuring) |
| Installer size, cold start | build output, first-paint timing | track per release |

**Add (privacy-safe: no prompt text, customer names, ids or tokens):** pack bytes and estimated tokens (AG-9), schema-parse duration per operation and payload bytes (TR-3, TR-4), event-loop delay histogram on Web/Teams hosts, cache hit counters (Q-8, Q-9, OR-1), retry counts and `Retry-After` waits (Q-1).

**Gates.** A nightly performance job (extend `test:perf:backends`) that fails on p95 regression beyond a tolerance, and a bundle-size check on PRs. Both are cheap compared with the current second test run (BS-1).

**Quality guard for every agent change.** Re-run each agent's `golden-scenarios.json` (including `readable-markdown-presentation`) and the Foundry evaluation suites before and after AG-1, AG-3 and AG-10. Keep `foundry-agent.json` `definition.instructions` byte-equal to `prompts/instructions.md` (enforced by `foundry-agent-manifests.test.ts`) and publish a new Foundry version each time; earlier versions stay available for rollback.

## 12. Trade-offs and rules that constrain the plan

- **"Agent reads are fresh."** The plan keeps it: OR-1 and AG-7 only share *in-flight* work between concurrent identical requests. A short TTL cache keyed by opportunity `modifiedon` would save more (about four times on four-agent scenarios) but changes the documented rule and risks stale advice; do it only if the baseline shows context time over about 3 s p50.
- **Authorization isolation.** Any shared cache, token cache or single-flight key must include tenant, user and delegated scope. Treat a cross-user hit as a security defect, with a test for it.
- **Validation is a security control.** TR-3 removes redundancy only *inside* a trusted host; Zod parsing at every untrusted edge stays.
- **Contracts.** TR-4 (projections) and any new operation change wire shapes: bump `contractVersion`/`workflowContractVersion` and update `tests/contract/*`.
- **Three-surface parity.** Shared code (`apps/shared`, orchestrator) lands once and benefits all four surfaces; per-surface changes (VS Code webview, Teams host) need the equivalent check on the others.
- **Sample and live parity.** Fallback paths (OR-5, Q-12) keep sample mode working.

## 13. Recommended sequence

| Wave | Contents | Why first |
| ---- | -------- | --------- |
| 0: measure (days) | Baseline per section 11; add the missing metrics (AG-9, request counters). | Everything else is guesswork without it; the 2 minute figure in earlier docs is not reproduced by the measured model call (about 20 s). |
| 1: quick wins (about 1 sprint) | AG-1, AG-2, AG-4 (config), UI-1/UI-2, Q-1, Q-8, Q-9, Q-12, TR-1, TR-2, BS-1, BS-2, OR-4, OR-5. | Small, low-risk, shared code, each directly measurable. |
| 2: reduce waiting (1 to 2 sprints) | Q-2, Q-3, Q-4, Q-5, Q-6, OR-1, OR-2, AG-3, AG-5, AG-7, AG-8, UI-3, UI-5, BS-3, BS-7. | Cuts the time before the model starts and the weight of the first paint and installer. |
| 3: structural (planned work) | UI-4 (split `App.tsx`), TR-3, TR-4, TR-5, TR-6, OR-3, OR-6, Q-10, Q-11, AG-6, AG-10, BS-6, BS-8, BS-9 gates. | Larger, touch contracts or several surfaces; schedule with tests per layer. |

## 14. Corrections made while writing this document

Recorded so nobody re-raises them:

- **"Reasoning effort dominates generation time"** (Agentic-Performance.md section 2, row 2) is not supported by measurement: reasoning tokens were 0. Output length is the driver (AG-1). The Foundry-side advice to "lower reasoning effort" remains harmless but is not the main lever.
- **"The model call takes two minutes or more"** was the symptom that started the earlier work; the measured v3 model call here is about 18 to 22 s from first token to end. Remaining delay a user sees is context preparation, the UI, and any failed/retried first attempt. Baseline in the app before claiming further gains.
- The **per-milestone activities N+1** and the **25-way evidence fan-out** were reported but are not live-path problems (section 8 note, OR-5).
- **VS Code activation** is `onStartupFinished`, not `*`; the finding is about eager loading after startup, not blocking startup (BS-7).
- The **`release*` folders** (7.9 GB, 586 MB) are gitignored local build output; only their file counts and contents matter for what ships.
