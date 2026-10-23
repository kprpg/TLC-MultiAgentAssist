# Reusable prompts — Stage and Pipeline Review

Copy a prompt, fill the `{placeholders}`, and run it with this skill loaded. Each prompt is self-contained
and repeats the guardrails that matter.

## 1. Generate the dashboard from reference screenshots

```text
Using the stage-pipeline-review-dashboard skill, analyze the attached screenshots of the
"{reference dashboard name}" and build/refresh the "Stage and Pipeline Review" dashboard.
- Code: apps/shared/dashboards/StageAndPipelineReview/ ; register it as a child tab of the Dashboards pane.
- Capture, per screenshot: header/subtitle, scope toggles, every filter in the filter bar and its options,
  active-filter chips, tab names + count rules, alert cards, KPI tiles, charts (series, legend, coverage chips, footnote),
  table columns, row actions, and footer.
- Define a strict Zod contract (packages/common/contracts) and a FICTITIOUS sample fixture; never copy customer names,
  IDs or amounts from the screenshots.
- Put all filter/KPI/alert/chart/CSV logic in a pure analysis module with unit tests; keep components presentational.
- For any tab without a screenshot, infer a design from its name/count and list it as an assumption.
- Validate: contract + unit tests, typecheck, eslint, and the Playwright spec. Report changed files and results.
```

## 2. Add or change a filter

```text
In the Stage and Pipeline Review dashboard add a "{filter name}" filter ({single|multi}-select, options from {field}).
1. Add the field to the contract/fixture if missing (bump stagePipelineReviewContractVersion if the wire shape changes).
2. Extend ReviewFilters, defaultReviewFilters, filterOpportunityViews, activeFilterChips and clearFilterChip in stage-pipeline-analysis.ts.
3. Render it in stage-pipeline-filters.tsx (same visual pattern as the neighbouring filters) with an accessible label.
4. Make sure Reset clears it, its chip is removable, and tab counts / alert cards / milestones respect it.
5. Add unit tests for filtering + chip behaviour and extend the Playwright journey.
```

## 3. Add or change a tab

```text
Add a "{tab name}" tab to the Stage and Pipeline Review dashboard showing {purpose}.
Derive rows from the already-filtered OpportunityView list (or milestones) in stage-pipeline-analysis.ts so the tab count
equals the number of rows shown. Reuse Kpi, Pill, ReviewTable and RowActions. Add the tab to the tab list in
stage-pipeline-review.tsx with keyboard navigation, update dashboard-spec.md, and add unit + e2e coverage.
```

## 4. Wire live MSX data

```text
Follow references/data-mapping.md "Live-wiring checklist" to feed the Stage and Pipeline Review from live MSX/Dataverse/MSXi.
Use ONE orchestrator operation shared by Electron IPC, HTTP and the webview bridge, with transport-parity tests.
Discover unconfirmed field names with the Dataverse describe tool; do not guess. Preserve sample mode, MCP default-deny,
query-guard allowlists, delegated-user scope and no-customer-data telemetry. Return partial-source warnings, not silent gaps.
```

## 5. Screenshot parity review

```text
Compare the running Stage and Pipeline Review dashboard (sample mode, 1600px wide) with these reference screenshots:
{attachments}. For each of: header, scope toggles, filter bar, chips, tabs, alert cards, KPIs, ACR chart, opportunity table,
milestone tab, produce a pass/gap list against references/dashboard-spec.md. Fix gaps in the smallest possible diff, re-run the
Playwright spec, and note anything intentionally different (naming, fictitious data, removed branding).
```

## 6. Refresh the fixture

```text
Update packages/common/fixtures/stage-pipeline-review.ts so every alert card, stage, milestone status, forecast and inbound/Microsoft Services
case has at least one fictitious row, ACR layers reconcile (actual + baseline + committed + uncommitted + stage1 ≥ target at June),
and the contract/unit tests still pass. Do not introduce real company names, people or amounts.
```
