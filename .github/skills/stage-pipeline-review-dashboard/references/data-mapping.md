# Data mapping — contract ↔ MSX / Dataverse / MSXi

Status: sample mode uses `createSampleStagePipelineReview({ scope, reportIds })` (`packages/common/fixtures/stage-pipeline-review.ts`); live mode is implemented.

- Contract: `stagePipelineReviewContractVersion` **1.1** (scope mine/reports/both, `reports`, per-source `sources` health, `capabilities`, nullable ACR with `acr.source`). There is no `capabilities` field: managers may not edit, so no manager forecast commit exists and report-scope rows are never editable.
- Connector: `packages/connectors/msx/stage-pipeline.ts` (+ `stage-pipeline-mapping.ts`) reads through `LiveMsxConnector.readRows/listDealTeamOpportunityIds/listMilestoneTeamOpportunityIds`.
- Host: `packages/orchestrator/stage-pipeline-review.ts` (+ `stage-pipeline-cache.ts`: 5-minute per-user cache, single-flight, stale fallback). Operation `stagePipelineReview` over Electron IPC `tlc:stage-pipeline-review`, `POST /api/stage-pipeline-review`, the VS Code bridge and Teams operations.
- Live ACR actuals/baseline/target are **not connected** (no Dataverse source); the chart uses pipeline layers derived from open milestones. Per-opportunity MACC is not available (account-level `msp_maccdata` only).
- Writes reuse the existing confirmed operations (`updateOpportunity`, `updateMilestone`, `createMilestoneActivity`); there is deliberately no manager forecast commit (decision: managers may not edit).

## Contract (`stagePipelineSnapshotSchema`, v1.0)

| Field | Meaning | Candidate live source |
| --- | --- | --- |
| `owner`, `asOf`, `fiscalYear`, `generatedAt` | signed-in seller, reporting date, FY, snapshot time | delegated user identity; server clock |
| `opportunities[].id/number/customer/name` | opportunity id, number, account, topic | `opportunity` (`opportunityid`, number, `_parentaccountid_value`, `name`) |
| `.notes` | latest forecast comment | `msp_forecastcomments` / `msp_forecastcommentsjsonfield` (treat as untrusted text) |
| `.stage` | MCEM sales stage (5 values) | `msp_activesalesstage` (option set → label) |
| `.closeDate` | est. close | `msp_estcompletiondate` / `estimatedclosedate` |
| `.consumedRecurring` | recurring consumed $ | `msp_consumptionconsumedrecurring` |
| `.solutionArea`, `.scope` | solution area tag; Azure vs Microsoft Services | `msp_solutionarea` (option set → label) |
| `.status` | opportunity status | `statecode` / status reason |
| `milestones[]` | engagement milestones | `msp_engagementmilestone`: `msp_name`, `msp_milestonedate`, `msp_milestonestatus`, `msp_commitmentrecommendation`, `msp_monthlyuse`, owner, `_msp_opportunityid_value` |
| `acr` (12 months × customer) | MSXi account ACR: actuals, baseline, committed/uncommitted/Stage 1 pipe, target | MSXi snapshot (not Dataverse); the screenshots show "MSXi snapshot synced <date>" |

**Not yet confirmed — discover with the Dataverse `describe` tool or the entity map before use; never guess logical names:**
forecast category, non-recurring consumed, MACC commit, partner, competitor + threat level, idle days, days-in-stage,
inbound flag, solution-tag-review flag, contact. Add confirmed fields to `config/dataverse.entity-map.json`
(honouring `includeInPrompt` / sensitivity) and the `query-guard` allowlists.

## Live-wiring checklist (follow-up, mirrors Seller Dashboard)

1. Orchestrator: add one read-only `stagePipelineReview` `get` operation in `packages/orchestrator` (shared host; no per-UI fork).
2. Connector: map Dataverse/MSXi rows to the contract; keep the Dataverse `query-guard`, MCP default-deny and delegated-user scope; paginate; surface partial-source warnings instead of empty results.
3. Transports: expose the same operation over Electron IPC (`assertTrustedSender`), the HTTP API (same-origin, Easy Auth, `no-store`) and the VS Code webview bridge; add a transport-parity test in `tests/unit/hosts/`.
4. UI: pass `invokeStagePipelineReview` from each surface's data client into `DashboardWorkspace`; keep sample mode as the offline default.
5. Privacy: no prompt text, customer names, amounts or tokens in telemetry/logs; no persistence beyond the Focus/Reviewed ids.
6. Bump `stagePipelineReviewContractVersion` if any shape changes; update contract tests and `docs/`.
