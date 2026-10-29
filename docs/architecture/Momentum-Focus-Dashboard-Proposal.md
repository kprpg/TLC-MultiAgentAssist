# Momentum & Focus Dashboard Proposal for SSPs and SEs

Status: **MP01-MP08 implemented and feature-verified on all four surfaces, with repository gate exceptions recorded below. MP09 (M365) remains out of scope.**

## Recommendation

Add **Momentum & Focus** as a new child tab of **Dashboards**, alongside the existing Seller,
Stage and Pipeline Review, and SE Reporting dashboards. Make it a decision dashboard:
**what is moving, what needs my attention, and why?** Not merely a count of CRM updates.

A shared browser-safe view and analytics contract are proposed for Desktop, Web, VS Code, and Teams.
The original proposal was prepared from source-code inspection; no live business records were queried.
MP01-MP08 were subsequently authorized for implementation across all four surfaces. The design below
is retained as the requirement baseline; the implementation and operational limits are recorded next.

## Implemented MSX-first runtime

- **One operation:** `momentumFocus` in the shared application registry, with strict independent
  contract v1.2 and a complete scoped `load` dataset (with explicit refresh/history capture).
  Fresh `get`, `refresh`, and snapshot-bound `detail` reads remain available to operation callers.
  Desktop uses trusted
  `tlc:momentum-focus` IPC; Web uses same-origin authenticated `POST /api/momentum-focus`; VS Code
  uses the validated `momentumFocus` bridge; Teams uses its authorized application-operation route.
- **One view:** the lazy **Dashboards > Momentum & Focus** tab uses the components in
  [momentumFocus](../../apps/shared/dashboards/momentumFocus/). Seller Dashboard remains the default.
  The standalone Vite preview uses a host-side synthetic operation, not a second UI scoring engine.
- **Sources:** caller-scoped MSX deal/milestone-team IDs, raw opportunity/milestone fields, dated
  task/note creation metadata, and the latest recorded forecast-comment timestamp. Generic
  `modifiedon` is freshness only. Task state or due date does not establish a proof-completion event.
  The current adapter has no authoritative CRM audit feed; live movement is qualified refresh
  observation history, never a reconstructed stage age.
- **Bounded read model:** up to 5,000 opportunities, 20,000 milestones, 5,000 tasks and 5,000 notes,
  collected in ID batches of 40; at most 1,000 dated source metadata entries plus 96 retained
  private observations per record. Membership and
  currency references use canonical IDs. Capped/denied/partial sources qualify the cohort and totals.
  Milestone currencies are not inherited from the parent opportunity. Unknown activity states stay
  null, remain in the verification queue and are excluded from confirmed active-opportunity counts.
- **Scope:** My work requires verified owner/deal-team/milestone-team IDs. Team is available only
  for the current Dynamics direct-report hierarchy, still under the caller's delegated source
  permissions. SSP/SE selection changes explanations and ordering, not authorization.
- **Calendar/rules:** Monday-start calendar weeks and calendar months in an IANA timezone; date-only
  CRM deadlines remain date-only. Focus and trailing evidence windows are independent. Inactivity
  uses a 14-day review threshold in connected sources; no-observed-progress uses a separate 30-day
  window, even when the displayed evidence lookback is shorter. Holds and MCEM loopbacks are context,
  not loss/failure. A linked active blocked milestone also surfaces its parent dependency.
  Qualified milestone outcomes contribute to their parent opportunity's traction without requiring
  a stage-number change; linked evidence references are retained and account traction is counted once.
- **Comparison coverage:** zero observed progress and advancing-share denominators require the
  requested history window to be covered, the last observation within 24 hours, and observed gaps
  no greater than 14 days. Short, stale or widely gapped histories remain unknown/partial; verified
  movement in a partial window is a labelled lower bound, not a complete comparison cohort.
- **Charts:** matrix, ranked account bars (traction/activity/review), milestone stage/status heatmap,
  and separate opportunity/milestone deadline distributions cross-filter the queue. Keyboard/table
  alternatives, active filter chips, native horizontal table scrolling and narrow layouts are shared
  by all hosts. Monetary heatmaps and value ranges require an explicit basis and ISO currency.
  Aggregates use the filtered read model, not the queue page. Unknown history has its own reference
  list and paginated queue lens; deadline bars keep opportunity and milestone series separate.

### HLS customer scope

Momentum now defaults to **HLS Customers only** inside the signed-in user's current authorized
portfolio. The shared `Customer industry` control can explicitly select **All authorized customers**;
Clear selection, role presets, horizon changes and refresh do not silently widen this industry scope.
This filters sector membership, not personal account ownership, and never changes CRM assignments.

The MSX account schema and choice definitions were verified through metadata-only reads on
2026-10-28. The authoritative field is `msp_verticalcode` (Vertical), with **Health Payor**,
**Health Pharma**, **Health Provider** and **MedTech** as the HLS groups. The generic `industrycode`
is labelled **Industry (Not Used)** and is deliberately not consulted. Option values are resolved
from current metadata rather than hard-coded tenant numbers, customer names or text keywords.

[customer-industry.ts](../../packages/connectors/msx/customer-industry.ts) validates the classification
metadata. The connector reads only the canonical account IDs already associated with the caller's
authorized opportunities, in bounded batches. Other and unclassified accounts are excluded before
milestone/activity reads, facets, chart totals, priority ranking or private history capture. Missing,
ambiguous or denied classification never falls back to an unfiltered customer list.

The **v1.1** HLS follow-up added `query.customerIndustry` and echoed the verified collection/snapshot scope.
The host and browser reject mismatched industry bundles, and all four transports use the same
operation. The current **v1.2** load-once contract retains these safeguards. Restart/reload older
clients and hosts together; v1.0 and v1.1 requests are intentionally rejected.
Synthetic fixtures remain offline and explicitly identify their HLS classification.

HLS follow-up validation: **85 focused tests passed**, including dynamic metadata values,
non-HLS/unclassified exclusion before dependent reads, explicit All opt-in, scope mismatch denial,
and four-transport parity. The complete bounded-worker suite passed **2,236 tests (36 skipped)**.
All **eight Momentum Revamp journeys** and the **Teams Momentum journey** passed, including customer
removal from the queue/facets and HLS preservation through Clear selection. All four surface builds,
root typecheck and targeted lint passed. Existing repository-wide gate exceptions below remain unchanged.

### Load once; filter and page locally

The shared pane now requests a complete, validated dataset for the selected authorized portfolio
and industry once, not a page-sized source response on every interaction.
[momentum-data-session.ts](../../apps/shared/dashboards/momentumFocus/momentum-data-session.ts)
keeps it in memory and single-flights concurrent first loads, including role/filter changes made
while that request is pending.

- Role presets, focus horizon/custom dates, timezone, evidence lookback, canonical slicers,
  entity/status/owner/quality/native-value filters, KPI lenses, chart controls/cross-filters,
  Clear selection, pagination/page size and item details make **no additional transport, MSX or
  private-history requests** for the loaded cohort.
- My work is a verified subset of the loaded personal portfolio. Team and All authorized customers
  still require explicit selection and a fresh authorized load the first time each cohort is opened.
  Broader data is not prefetched. Revisiting a loaded cohort uses its cache.
- There are at most four cohort entries (personal/Team by HLS/All) and two prepared filtered views
  per cohort. Paging slices the prepared full filtered rows; totals and chart aggregates never
  depend on the displayed page.
- There is still **one** deterministic projection implementation:
  [the browser-safe common projector](../../packages/common/projections/momentum-focus.ts).
  The existing orchestrator analytics entry point and the shared browser session both call it.
  No host-specific/UI-specific ranking engine, source access, agent invocation or financial
  conversion is introduced. Source/snapshot identities are host-generated; query fingerprints
  use the same SHA-256 representation in Node and the browser.
- The dataset includes a fixed evaluation clock. Focus/evidence windows and explanations refer
  to that loaded snapshot, not an apparently live moving window over stale records. The UI labels
  local filtering; source and observation timestamps remain visible.
- **Refresh and capture history** invalidates all cached cohorts/views, reads the current selected
  cohort once and captures its private observations once. Auth/source-session changes and pane
  disposal clear the cache. Dataset industry, cohort, source principal, mode and rule version are
  checked; denied, invalid and mismatched loads clear cached private data rather than falling back.

Authorization and current record membership are verified before the host exposes the dataset,
including history. Local detail renders that already-loaded authorized evidence; it does not claim
to recheck live record access on every click. Use Refresh for current source/access changes.
The existing source-generation invalidation also remounts the workspace after source/auth changes.
Other source updates remain as-of the loaded snapshot until an explicit Refresh.
Nothing is stored in localStorage/sessionStorage, URLs, telemetry or plaintext history files.

Load-once verification: the original shared browser journey made **15** Momentum requests; it now
makes exactly **2** (initial load and explicit Refresh) on Web, VS Code and Teams. The Desktop IPC
journey and loaded-dataset transport-parity checks also pass. A browser regression blocks all
subsequent requests and verifies role/window changes, paging, My work and details with **zero**
loading-state transitions. A 1,650-record canonical-derived cohort supports 50 page selections
with one source/transport load and only two prepared views (SSP and SE). Private-history spies
confirm no per-record rereads for view operations and one observation per record on explicit Refresh.

The full four-worker suite passed **2,252 tests (36 skipped)**; **20 Revamp** Momentum/layout/Stage
checks, the **Teams Momentum** check and **two Desktop startup** smokes passed. All four builds,
root typecheck, import boundaries and code lint excluding the unrelated `.venv` passed. The existing
vendored-JavaScript lint failures and untouched Teams missing-`override` diagnostics remain as
documented below. No live customer sources, CRM writes or production history store were used.

### Review-pattern layout

Momentum adopts the existing **Stage and Pipeline Review** visual foundation rather than presenting
one long unstructured report. Both panes use the same review typography/theme tokens and shared
browser-safe checkbox multiselect and keyboard-accessible section-tab controls.

- Compact header, scope/window controls, primary customer/stage/status/value/currency filters,
  active chips and a **More filters** disclosure.
- Six clickable KPI cards remain visible across sections and open the corresponding **Priorities**
  queue subset.
- Four focused sections: **Priorities**, **Traction & signals**, **Milestones & deadlines**, and
  **Sources & financials**. Switching sections is presentation-only and does not trigger a new
  orchestrator read or reset the selected filters.
- The priority table has separate date/value columns, sticky headings, bounded native scrolling,
  compact entity links, and two-line summaries. Full names/reasons/actions remain available through
  accessible labels, tooltips and **Why this item?**.
- Chart selections return to the filtered queue. Chart display controls keep the current chart section.
  Source coverage and native-currency financial groups use labelled tables rather than long bullet lists.
- HLS scope, independent clocks, authorization, rankings, history and financial calculations are
  unchanged. That layout-only change retained **v1.1**; the load-once follow-up above introduces
  **v1.2** without changing the priority rules or financial calculations.

The shared components are used by Desktop, Web, VS Code and Teams. Layout tests compare Stage/Momentum
light/dark palettes, cap long-label row heights, check native financial units, keyboard navigation,
popover boundaries and short/narrow-window scrolling. Short host windows can scroll; the standard
desktop density comparison uses a fixed 1536 by 960 viewport.

Layout alignment verification: **45 focused UI/sibling tests passed**; the full four-worker suite
passed **2,238 tests (36 skipped)**. **19 Revamp** Momentum/layout/Stage regression journeys and the
**Teams Momentum** journey passed. All four surface builds, root typecheck, dashboard lint and import
boundaries passed. Browser inspection measured sample queue rows at **64-79 CSS pixels**; long-label
tests enforce a **112-pixel** maximum, with native financial values unchanged. The temporary visual
preview was stopped after inspection.

### Private shared history configuration

Set the same `TLC_MOMENTUM_TABLE_URL` (an HTTPS `*.table.core.windows.net` service origin) and
optional `TLC_MOMENTUM_TABLE_NAME` (default `TlcMomentum`) on each live host. Provision the private
table and approve its storage/access/retention policy separately; opening the dashboard never
provisions Azure resources, enables CRM auditing, broadens grants or writes to CRM.
The approved host credential needs access to that table; no connection-string secrets are accepted.
Desktop/VS Code use the configured host credential, and hosted Web/Teams use their configured host
credential/managed identity. All business-source reads still use the delegated caller credential.

[MomentumHistoryRepository](../../packages/connectors/msx/momentum-history.ts) partitions by tenant,
principal, source origin and sample/live mode; keys are hashed. It stores only the minimal current
comparison fields and dated observed changes, not customer names, notes, amounts or tokens. Each
dataset load and direct get/detail first re-reads current source membership. Local UI projections
and details reuse the already-loaded, authorized evidence, without rereading history per record.
Explicit refresh captures observations using
revision-checked writes; concurrent captures, stage oscillations and repeat completions do not inflate
progress. Observation intervals and actual source event times are distinct.

Read retention is 180 days; expired record documents are removed when accessed and old events are
pruned. At most 96 recent changes are retained per record to stay within the secure store's document
bound; disclosed available-since coverage advances when older changes are clipped. Operators must
also configure approved physical-retention cleanup for dormant Azure Table records; the dashboard
does not install a cross-principal retention scheduler or claim that Azure Tables provide TTL.

If the secure shared store is absent, current priorities remain available with **history unavailable**.
If the configured store fails, the result explicitly discloses unavailable history and a partial read.
Neither condition falls back to plaintext files, browser storage, host-local customer history, or
sample business data. Sample mode uses the single fixed-clock synthetic fixture, no live sources,
no model calls and no Azure Table access. Its fabricated IDs intentionally do not link to live CRM.

### Implementation tests

Tests were written and run red before contract/core, collection/host, transport/UI and journey
implementation. The fixed-clock fixture covers modest-activity progress, busy/no-movement work,
a quiet material blocker, holds/loopbacks, incomplete history and mixed currencies/financial units.
The focused tests are `tests/contract/momentum-focus.test.ts`, Momentum tests under
`tests/unit/{connectors,orchestrator,hosts,shared}`, and the shared four-surface journey in
`tests/e2e/momentum-journey.ts` used by the Revamp and Teams Momentum specs.
No customer records or production history store were queried. The HLS follow-up inspected account
schema and choice metadata only, using existing delegated access.

### Initial MP01-MP08 verification record (2026-10-28)

| Check | Result |
| --- | --- |
| Focused Momentum contract, connector/history, analytics/host, four-transport parity and static UI tests | **69 passed** |
| Full suite, `npm test -- --maxWorkers=4` | **2,220 passed, 36 skipped**; 304 test files passed, five skipped |
| Revamp dashboard journeys (Momentum, Seller, Stage/Pipeline and SE Reporting) | **24 passed**, including Desktop IPC, Web, VS Code webview, keyboard/mobile, unknown-history selection, stale/denied/mismatched responses and malformed preview origins |
| Teams Momentum and sibling dashboard journeys | **2 passed**, over the real authorized Teams operation endpoint |
| Actual hosted Web sample | Health and Momentum HTTP **200**, strict unknown-history response with two null-progress records, `no-store`; complete shared Web journey passed |
| Repository Desktop smoke | **2 passed** |
| `desktop:build`, `web:build`, `ext:build`, `teams:build` | **Passed** |
| Root `typecheck`, import-boundary gate and code lint excluding the unrelated local Python virtualenv | **Passed** |

Repository-wide exceptions were retained rather than hidden or expanded into unrelated cleanup:

- Stock `phase0:check` stops at two `no-undef` lint errors in pre-existing pip-vendored JavaScript
  in the local `.venv`. `npx eslint . --ignore-pattern ".venv/**"` passes.
- Stock `validate:major` hits the existing five-second repository import-scan test deadline under
  the default unbounded worker concurrency. The import-boundary command, isolated architecture tests,
  and complete suite with four workers pass. The test deadline and default runner configuration
  were not changed; the stock major gate is **not green**.
- Stock `teams:typecheck` reports three pre-existing TS4114 missing-`override` errors in the untouched
  [workspace boundary](../../apps/teams/src/client/workspace-boundary.tsx). Teams builds pass and
  `npm --workspace @tlc/teams run typecheck -- --noImplicitOverride false` passes, isolating that rule
  without editing the class or project configuration.

Temporary hosted validation servers were stopped. Changes remain uncommitted; no infrastructure,
source-system writes, additional grants or live-data verification were performed.

![Illustrative dashboard design, using synthetic data only](../media/momentum-focus-dashboard/momentum-focus.png)

[Editable SVG mockup](../media/momentum-focus-dashboard/momentum-focus.svg).
All figures in the mockup are synthetic and are not live portfolio results.

## Confirmed choices

- New dashboard tab, rather than crowding Seller Dashboard.
- Default scope: HLS customers within the signed-in user's current authorized portfolio, with a
  verified My work lens and a permitted Team lens where supported. All authorized industries require
  an explicit selection.
- MSX first; optional M365 enrichment in a later phase.
- Include private, permission-scoped history capture on refresh and authoritative history where available.
- Balanced priority emphasis: urgency, material impact, readiness, and SSP/SE relevance.

Proposed reviewable defaults: current calendar week/month in the user's timezone; a separate
trailing 30-day evidence window; 14-day inactivity and 30-day no-observed-progress review flags.
These are not universal business rules or declarations that an opportunity has failed.

## The seven questions, translated into the experience

| Requirement | User question | Proposed answer |
| --- | --- | --- |
| MF-001 | Which accounts/opportunities have the most traction? | Top Accounts bars and an opportunity momentum view, showing verified/observed progress, recency, and coverage. Show advancing share as well as counts so large accounts do not win merely by size. |
| MF-002 | What should I focus on this month? | A ranked monthly opportunity/milestone queue: target/close dates, commitments, blockers, material impact, suggested next action and accountable role. |
| MF-003 | What should I focus on this week? | A shorter actionable queue: overdue work, upcoming checkpoints, near-term blockers and items needing a decision or evidence check. |
| MF-004 | What is not progressing? | A Needs review lens distinguishing no observed movement, date slippage, blocked work, planned holds, normal stage loopbacks and insufficient history. |
| MF-005 | What is high-activity and signal-rich? | Deduplicated signal counts, type/source breadth, recency and an evidence timeline. Keep engagement distinct from progress. |
| MF-006 | Can I slice and dice? | Shared account/customer, opportunity, milestone, parent stage, entity-specific status, owner, dates, value basis/range, currency, role and source-quality slicers. |
| MF-007 | Can I see graphical charts? | Linked bubble/scatter, ranked bar, stage/status heatmap and deadline-distribution views, with accessible table equivalents. |
| MF-008 | Can the results be trusted? | Provenance, coverage, cold-start and uncertainty states; no fabricated history, zero-filled missing data or unsupported revenue claims. |
| MF-009 | Is scope and access preserved? | Caller-scoped data and history, no new CRM writes, no automatic sharing, and no role-picker privilege escalation. |
| MF-010 | Will this work consistently across the product? | One contract, one orchestrator capability, shared UI and four-host parity tests. |

## Proposed page

1. **Context and slicers**: SSP / SE preset, portfolio/My work/permitted Team scope, hierarchy,
   stage/status, value basis/currency and source coverage. Active filter chips and Clear selection.
2. **Two distinct clocks**:
   - **Focus horizon**: This week / This month / Custom, for priorities and deadlines.
   - **Evidence lookback**: 7 / 14 / 30 / 90 days, for activity and movement.
   Changing the focus horizon does not silently erase the retrospective evidence window.
3. **Clickable summary cards**: advancing accounts, weekly priorities, monthly milestones,
   review candidates, busy-without-verified-movement, and usable history/source coverage.
4. **Prominent priority queue**: entity, customer, stage/status, recorded date or explicitly proposed
   review date, value with its unit, priority tier, why now, evidence quality and next step.
5. **Graphical context**: the matrix and account bars explain the queue; the heatmap exposes
   concentrations. Selecting a mark cross-filters the corresponding records, with a visible reset.
6. **Why this item?** drawer: top reasons, source facts and dates, evidence references, history
   coverage, proposed owner/handoff, and safe links to Portfolio/MSX/existing advisory workflows.

Keep the existing dashboard default unchanged. Load the new dashboard only when visited.
On narrow screens, prioritize the queue and filter drawer; stack charts and retain native table scrolling.

### Chart specifications

| Visual | Encodings | Interaction and safeguards |
| --- | --- | --- |
| Progress versus signals matrix | X: distinct qualified progress events in the evidence window; Y: relevant dated signal count; bubble size: selected, same-currency value basis. Opportunity/milestone grain is explicit. | Moving + engaged, busy but not advancing, and quiet/review patterns. Unknown history is a separate list, not a dot at zero. Partial cohorts are labelled, not silently compared as complete. |
| Top Accounts bars | Advancing share of eligible active opportunities, with numerator/denominator, absolute progress count and latest movement. | Switch Traction / Activity / Needs review. Counts alone do not reward account size. Selecting an account narrows the linked hierarchy. |
| Stage x Status heatmap | Milestone count or verified monthly potential, by parent opportunity stage and milestone status. | Clicking a cell applies both dimensions. Count and monetary modes are never conflated; unknown stage/status remains visible. |
| Deadline distribution | Overdue / This week / Rest of month / Later / Undated, with opportunity and milestone series clearly separated. | Opens the relevant focus-queue subset. A recommended review date is not presented as a recorded CRM deadline. |

## Definitions and prioritization

### Do not collapse different questions into one opaque score

- **Activity volume**: distinct dated business activities/notes/tasks observed in the allowed sources.
  Exclude refreshes, agent runs, administrative noise and duplicate representations of the same activity.
- **Signal richness**: volume plus relevant type/source breadth, recency, reliable association and coverage.
  A note or record edit is evidence of activity, not automatically a positive customer outcome.
- **Traction**: supported movement toward an outcome: qualified readiness/stage change, meaningful
  milestone completion, a recorded commitment/decision or completed proof checkpoint where evidenced.
- **Stagnation**: a review candidate based on available history and context, not merely an old stage.
  Planned holds and long-cycle work need their next checkpoint considered.
- **Priority**: the action warranted now. A quiet but overdue material blocker can outrank a busy,
  healthy opportunity.

Use explainable **Act now / This week / Plan this month / Verify information** tiers in v1.
Within comparable records, order by urgency, role relevance, appropriate impact band, readiness and
evidence recency; keep tie-breaks deterministic. Do not mix monetary units or invent win probabilities.
Show the drivers and rule version rather than an unexplained 87/100 score.

For account traction, show the share of sufficiently observed active child opportunities advancing,
alongside the counts and coverage. Allow explicit activity-volume sorting as a different lens.
Repeated refreshes, reopenings, oscillating fields and date pushes must not inflate positive progress.

### SSP and SE presets

| Preset | Emphasis | Example next-step emphasis |
| --- | --- | --- |
| SSP | Commercial decisions, qualified pipeline, close/commitment windows and material blockers. | Confirm the decision/next commitment; resolve a commercial dependency; route stage-field work to the accountable Specialist. |
| SE | Technical proof/readiness, milestone outcomes, delivery feasibility and proof blockers. | Complete or re-scope proof; resolve a technical dependency; arrange the right CSA/CSAM/Specialist handoff. |

Role selection changes emphasis and explanation, never authorization. Important cross-role blockers
remain visible. MCEM is non-linear: a loopback is not a loss or automatic failure, and useful progress
can occur without changing the stage number.

## Financial and filter semantics

- Opportunity value is **pipeline value**, not recognized revenue, earnings or guaranteed credit.
- Milestone monthly usage/ACR potential is a **monthly rate**, not the same measure as opportunity value.
  Never add the two, and never multiply a parent opportunity value by its milestone count.
- Preserve source currency/unit. Aggregate one validated currency/basis at a time, or show separate
  groups; do not assume exchange rates or inherit a currency without verified attribution.
- Missing amounts/dates/status are explicit unknowns, not zeros. Undated or incomplete records can
  still need attention and must not disappear merely because a source mapping expects a close date.
- Stage on a milestone means its parent opportunity's stage. Status choices are entity-specific.
- Use canonical account/record IDs and verified membership/owner IDs, not name-only matching.
- Chart totals come from the complete filtered read model, not just the visible table page.
  If collection is partial or capped, qualify rankings and totals accordingly.

## What existing code supports, and what must be added

| Evidence from the repository | Consequence for this proposal |
| --- | --- |
| [dashboard-workspace.tsx](../../apps/shared/dashboards/dashboard-workspace.tsx) already hosts three shared dashboard tabs. | Add a lazy child tab and a typed invoke adapter; do not create four independent dashboards. |
| [Portfolio contracts](../../packages/common/contracts/index.ts) provide account/opportunity/milestone identifiers, current stage, dates, value, status, commitment and membership fields. | Current priorities are feasible, but these thin rows do not establish full historical progression. |
| [Connector interfaces](../../packages/connectors/common/index.ts) expose deeper opportunity evidence with dated comments, notes, activities, milestone tasks, gaps and retrieval health. | Reuse the read seams and source facts; validate what each timestamp actually represents. |
| [agent-evidence.ts](../../packages/orchestrator/agent-evidence.ts) intentionally caps prompt entries and milestones. | Do not rank the whole portfolio from an LLM-truncated evidence pack or treat its counts as complete analytics. |
| [Stage/Pipeline mapping](../../packages/connectors/msx/stage-pipeline-mapping.ts) can default unknown stage age to zero, and idle days are a conditional forecast-comment age. Its [collector](../../packages/connectors/msx/stage-pipeline.ts) also has scope exclusions. | Reuse validated source primitives, not those fields/subsets as universal proof of progress or inactivity. Preserve null/provenance in the new read model. |
| [Seller Dashboard](../Seller-Dashboard-Implementation.md) supports financial/current pipeline and some optional timestamps; its private quota/MINT workflow has different boundaries. | Do not require quota onboarding or borrow private earnings data for this dashboard. |
| [Graph evidence](../../packages/connectors/graph/se-evidence.ts) provides delegated M365 evidence primitives for another feature. | Phase-two reuse requires a capability/privacy review and reliable record association. Existing account-name matching alone is not proof of an opportunity link. |
| [operations.ts](../../packages/orchestrator/operations.ts) registers existing dashboard capabilities. | Add a single read-only operation family with versioned contracts and transport parity. |

This is a source-code feasibility assessment, not proof that every field, audit feed or M365 grant
is available in the user's live environment. No live/customer query was performed for this proposal.

## History and source honesty

- Prefer authoritative field/event history where access is already permitted. Do not enable CRM
  auditing, broaden grants or write to CRM as a side effect of opening a dashboard.
- Capture app-owned, minimal before/after observations on authorized refreshes. Record source event
  time separately from observation/ingestion time. A change detected between two observations has an
  interval; do not invent its precise occurrence time.
- A generic `modifiedOn`, edited comment or task due date is not a stage transition or task-completion date.
- First use shows **History available since...** and insufficient-history states. Do not backfill
  the last month from today's fields or paint an observation gap as flat historical performance.
- Explicit refresh capture is not continuous monitoring. Say **no observed progress** when that is all
  the evidence supports. Current due-date/blocked-item priorities remain useful during cold start.
- Prefer one principal-isolated history repository shared across the four surfaces. A local-only pilot
  must say **host-local history** and cannot claim cross-surface history continuity.
- Proposed retention is 180 days, subject to the existing data policy and approved secure store.
  Partition by tenant, principal, source identity and sample/live mode; deduplicate concurrent captures.
  Recheck current record access before exposing historical data.
- No customer history in browser localStorage, URLs or telemetry. No silent plaintext or sample fallback.

## Architecture and boundaries

Browser-safe `momentum-focus` contract v1.2: complete scoped datasets, a fixed evaluation clock,
customer-industry scope, query/filter windows, entity and monetary
semantics, canonical rows, chart series, priority reasons, evidence references, history provenance,
scope/completeness and source-health states. Parse at boundaries; add an independent contract rather
than breaking existing portfolio/Seller/Stage schemas.

One orchestrator service owns authorized collection, private history and source/snapshot identities.
One browser-safe common projector owns deterministic deduplication, ranking and aggregation and is
shared with the browser's in-memory dataset session, not copied per UI. Expose source reads through
the single `momentumFocus` load/get/refresh/detail family. Caller identity comes from the host,
never from a role filter. Collect in bounded batches; avoid an agent invocation, source reload or
N+1 history/deep-evidence reads per row on a filter/page change.

The shared UI only presents that read model. All four hosts marshal the same operation. Publish a
coherent result bundle with its filter/snapshot identity and per-source timestamps; reject stale
responses after scope changes, and clear inaccessible data when authorization changes.

MVP is read-only against business systems. No automatic task creation, CRM updates, notifications,
publishing, compensation calculations or additional LLM scoring. Existing reviewed actions/advisory
flows can be opened explicitly. M365 stays visibly unconnected until its separate integration is approved.

## Implementation outline and dependencies

MP01-MP08 below are the authorized MSX-first implementation baseline; MP09 still requires separate approval.
Dependencies are recorded in the table so the document remains self-contained.

| Task | Work and key components | Depends on |
| --- | --- | --- |
| MP01 | Validate field provenance, source bounds, calendar/status mappings and secure shared-history storage; finalize the rule table and cold-start behavior. Anchor on the source files above. | None |
| MP02 | Add `packages/common/contracts/momentum-focus.ts`, canonical synthetic fixtures and contract tests, including nullable/unknown and financial-basis semantics. | MP01 |
| MP03 | Add bounded MSX collection plus a principal-isolated history repository/adapter, without CRM writes or forced audit access. Keep source and observation timestamps distinct. | MP02 |
| MP04 | Add pure analytics through `packages/orchestrator/momentum-focus/`, using the one browser-safe projector in `packages/common/projections/`: linked-scope filtering, event deduplication, priority tiers, account rollups and chart datasets. | MP03 |
| MP05 | Register the capability in `packages/orchestrator/operations.ts` and host composition; wire the existing Desktop/Web/VS Code/Teams invoke/data-client adapters. | MP04 |
| MP06 | Build focused browser-safe components under `apps/shared/dashboards/momentumFocus/` for filters, queue, charts, reasons and source/history states, initially against the contract fixtures. Reuse existing typography/themes. | MP02 |
| MP07 | Add the lazy tab in `dashboard-workspace.tsx`, wire the shared pane into all four hosts, and verify drill-through, scope resets, keyboard interaction and responsive layouts. | MP05, MP06 |
| MP08 | Run unit/contract, transport-parity, accessibility/static/interaction and surface e2e checks; update related docs/folder structure; verify sample/live boundaries and report source limitations. | MP07 |
| MP09 | Optional later M365 enrichment: explicit app grants, privacy/capability validation, minimal metadata, robust association/deduplication and no cross-user private-signal leakage. Not part of MSX-first MVP approval. | MP08 and separate approval |

MP06 can proceed independently of backend MP03-MP05 once MP02 is stable. Do not build a new frontend
stack, add a separate per-UI scoring engine, or couple this capability to the private MINT collector.

### Phased delivery, without fabricated completeness

1. **MSX-first decision view**: current priorities, structured signals, explicit history capture,
   source coverage and honest cold-start states.
2. **History-backed movement view**: trustworthy traction/stagnation comparisons as authoritative or
   sufficiently qualified history becomes available; keep observed and authoritative views distinct.
3. **Optional M365 enrichment**: additional context only after access and attribution have been proven.

## Acceptance and testing

- Each of the seven requested questions has a filterable view, a clear measure, and a way to inspect why.
- All four UIs return the same results for identical authorized inputs, history, clock, rules and filters.
  Different history availability is disclosed, never silently normalized.
- Weekly/monthly classifications handle timezone boundaries, date-only fields, month ends and DST.
- Generic edits, duplicate tasks, repeated refreshes, date pushes, reopenings and assistant usage do not
  manufacture progress. Legitimate MCEM iteration is not labelled a loss.
- Cold-start, undated, partial, denied, capped and stale inputs remain explicit. Unknown is not zero.
- Financial totals reconcile at the selected grain/currency/basis without parent-child double counting.
- User A cannot see user B's history/private signals; role/filter changes cannot widen authority.
- Charts cross-filter correctly, have keyboard/screen-reader alternatives, and remain usable on narrow
  Web/Teams/VS Code views. Aggregate values do not change merely because rows are paginated.
- The default suite uses one fixed-clock synthetic dataset and no live network/model calls.
  Include contrasting cases: advancing with modest activity, busy without movement, a quiet material
  blocker, a planned hold/loopback, incomplete coverage, and mixed currencies/value units.
- Use the repository's existing builds, unit/contract/parity tests and relevant UI smokes. Capture
  pre-existing gate failures separately; do not mask them or broaden this feature into unrelated cleanup.

## Requirement mapping

| Requirement | Tasks |
| --- | --- |
| MF-001 | MP01, MP02, MP03, MP04, MP06, MP07, MP08 |
| MF-002 | MP01, MP02, MP04, MP06, MP07, MP08 |
| MF-003 | MP01, MP02, MP04, MP06, MP07, MP08 |
| MF-004 | MP01, MP02, MP03, MP04, MP06, MP08 |
| MF-005 | MP01, MP02, MP03, MP04, MP06, MP08, optional MP09 |
| MF-006 | MP02, MP04, MP06, MP07, MP08 |
| MF-007 | MP02, MP04, MP06, MP07, MP08 |
| MF-008 | MP01, MP02, MP03, MP04, MP06, MP08 |
| MF-009 | MP01, MP02, MP03, MP05, MP07, MP08, optional MP09 |
| MF-010 | MP02, MP04, MP05, MP06, MP07, MP08 |
