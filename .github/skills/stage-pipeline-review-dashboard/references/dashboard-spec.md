# Stage and Pipeline Review — dashboard specification

Derived from eight reference screenshots of an "Azure Consumption Command Center". The product name here
is **Stage and Pipeline Review** and it is a child tab of the **Dashboards** pane. Tabs marked
*(assumed)* were not in the screenshots and are inferred from the tab names and counts; replace them
when real screenshots are available.

## 1. Header

- H1 `Stage and Pipeline Review`.
- Subtitle: `{owner} · {filtered} of {total} consumption opportunities · {consumed $} consumed · {live from MSX | synthetic sample} · {as-of date}`.
  `filtered` follows every top filter; `total` is all opportunities in the snapshot.
- Right side: three radio groups (see §2).

## 2. Scope toggles (radio groups, active = filled brand colour)

| Group | Options | Notes |
| --- | --- | --- |
| Consumption scope | `Azure only` (default) · `Microsoft Services` · `All consumption` | Switching scope also resets the **Solution** dropdown/chip to `Cloud and AI Platforms`, `Microsoft Services`, or all. |
| Opportunity source | `All opps` · `Inbound only (n)` · `Exclude Inbound` (default) | `n` = inbound opportunities in the current scope. Inbound opps are flagged by the data (`inbound`). |
| Metric | `Consumed $` | Single option today (the only metric the screenshots show). |

## 3. Filter bar (left → right)

1. Free-text search: topic/opportunity, customer, contact, partner, notes, number.
2. `All customers` (single select) — also drives the ACR chart.
3. `All statuses` (opportunity status: In Progress, On Hold, Won, Lost).
4. `All forecast categories`.
5. `All stages` multi-select: Listen & Consult, Inspire & Design, Empower & Achieve, Realize Value, Manage & Optimize.
   Each row shows its count under all *other* filters; footer `Select all` / `Clear`; button label is `All stages`, the stage name, or `n stages`.
6. Solution dropdown (`Cloud and AI Platforms`, `Microsoft Services`, …) — options depend on scope.
7. `All fiscal quarters` — Microsoft fiscal quarter of the **close date** (FY starts 1 July: `FY27 Q1` = Jul–Sep 2026).
8. `All partners`.
9. `★ Focus only` toggle · `Hide reviewed` toggle · `Reset` (restores Azure only + Exclude Inbound + default solution).

**Active-filter chips** sit under the bar: `Solution: …`, one `Stage: …` per selected stage, `Opportunity: Excluding Inbound|Inbound only`,
then customer/status/forecast/quarter/partner/alert/search when set. Each chip has a `×` that clears just that filter.
(Clearing the Opportunity chip sets the source to `All opps`.)

## 4. Tabs with live counts

`Opportunities` · `Actions` · `Consumption` · `MACC & Commits` · `Milestones` — each shows the count after top filters.
Arrow/Home/End keyboard navigation; `role="tablist"`.

## 5. Opportunities tab

**Alert cards** (click toggles an `Alert:` filter; counts are computed *before* the alert filter so the cards stay visible):

| Card | Rule (open opportunities only, relative to the snapshot as-of date) | Hint |
| --- | --- | --- |
| Overdue close | close date < as-of | re-date or close |
| Closing ≤90d | 0 ≤ days to close ≤ 90 | drive to close |
| At-risk commit | forecast `Committed` and (overdue or has an At Risk/Blocked milestone) | protect forecast |
| Non-Azure consumption | source flag `solutionTagReview` | check solution area tag |
| Competitive threat | competitor threat High or Medium | High / medium · compete plan |

Each card shows count, `$ consumed`, and the hint.

**KPI tiles**: Recurring consumed · Non-recurring consumed · Opportunities · Actively consuming (consumed > 0) · Overdue close · MACC commit in pipeline.

**ACR Actuals and Outlook** (SVG, cumulative FY, Jul→Jun):
- Stack per month: Actuals YTD (green) → ACR baseline YTD (gray) → Committed pipe (blue) → Uncommitted pipe (yellow) → Stage 1 pipe (light yellow). Black line + dots = ACR target YTD. Total label above each bar; `$` labels inside green/gray segments. `*` marks the last actual month.
- Coverage chips use the final month: target; `% actuals + baseline`; `+ committed`; `+ uncommitted`; `+ Stage 1`; `$ ahead of / behind target with all layers`. Percent colour: ≥100% green, otherwise red for the first two, amber for the others.
- Footnote must state that the chart is account-level Azure ACR from MSXi and follows **only the Customer filter**.

**Opportunity table** — `N shown · $X consumed`, `Export CSV`, sortable headers, scrolling body:
Customer · Opportunity (+ notes, small) · Stage · Forecast pill · Close (red pill when overdue) · Days (to close, negative = overdue) · Consumed · Idle (d) (grey pill ≥ 30) ·
Partner · Competitor (+ threat) · Flags (`Overdue Nd` red pill; `Nd` amber pill when days-in-stage ≥ 14) · Actions (↗ open in MSX, ☆ focus, ✓ reviewed, ✉ email draft, ⧉ copy).
Reviewed rows are dimmed; overdue rows get a faint red tint. Rendering is capped (100 rows, `Show more`).

## 6. Actions tab *(assumed)*

Rows derived from the alert rules: High — overdue, at-risk commit, High competitive threat; Medium — Medium threat, solution-tag review, closing ≤90d;
Low — consuming but idle ≥ 60 days. Sorted by priority then close date. KPIs: total, High, Medium, Low. Advisory only — never writes to MSX.

## 7. Consumption tab *(assumed)*

Consuming opportunities only: KPIs (actively consuming, total consumed, idle ≥ 30 days), a top-8 customers-by-consumed bar list, and a table (recurring, non-recurring, total, idle, row actions).

## 8. MACC & Commits tab *(assumed)*

Opportunities with `maccCommit > 0`: KPIs (count, MACC commit in pipeline, committed-forecast count, consumed on MACC opps) and a table with commit, consumed, burn % (= consumed ÷ commit), forecast, close, row actions.

## 9. Milestones tab

Hint line: milestones under the opportunities in the current scope (top filters apply); ACR = Est. change in monthly usage.
- KPIs: Milestones shown · Open est. monthly ACR · Open · committed · Open · uncommitted · At risk / blocked · Past due (still open).
  *Open* = On Track, At Risk or Blocked. *Past due* = open and milestone date < as-of.
- **Milestones by status**: On Track, At Risk, Blocked, Completed, Cancelled, Hygiene/Duplicate, Lost to Competitor — clickable bars (toggle the status filter), bar length relative to the largest, label `visible · total`.
- Filter row: `All statuses` multi-select · `All commitments` · `All owners` · `Open milestones only` · `Overdue milestones (n)` · `Clear milestone filters` · `Export CSV`.
- Summary: `N milestones across M opportunities · $X open est. monthly ACR`.
- Table: Account · Opportunity (+ number) · Milestone (+ number · workload) · Est. ACR/mo · Commitment pill · Status pill · Milestone date (red pill if past due) · Milestone comment (truncated with `(more)`) · Owner · Open in MSX (Milestone | Opportunity radio + `↗ Open`).

## 10. Footer

None. The reference page-level footer (product branding, source note) is intentionally omitted; only the ACR chart keeps its own explanatory footnote.

## 11. Cross-cutting behaviour

- Marks (Focus/Reviewed) persist in `localStorage` under `tlc.stagePipelineReview.marks.v1`; storage failure degrades to in-memory.
- Theme: surfaces and text use the shared Fluent/VS Code tokens, including charcoal surfaces in dark mode. Controls, links, selected tabs and filter chips use the host's blue accents; headings reuse the Portfolio cyan heading token (or Fluent teal). Filled controls use separate background/on-brand tokens so their text remains readable in light and dark themes. ACR chart layers and alert colours retain their existing meanings.
- Accessibility: radio groups, `aria-pressed` toggles, labelled table regions, sortable header buttons, SVG chart has a text summary.
- Empty/error states: loading text, `Retry` on failure, stale-snapshot notice, "No records match the current filters".
