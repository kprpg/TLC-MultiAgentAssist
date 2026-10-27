# Stage and Pipeline Review

A dashboard under **Dashboards → Stage and Pipeline Review** (Desktop, Web, VS Code, Teams).
It shows consumption opportunities by MCEM stage with alerts, ACR coverage and milestones.

> **Data:** sample mode renders a clearly labelled **synthetic sample**. Live mode reads your MSX portfolio
> (deal-team and milestone-team opportunities) with your own delegated identity. Monthly ACR actuals,
> baseline and target are **not connected**; the chart then shows pipeline layers derived from open milestones.
> See `.github/skills/stage-pipeline-review-dashboard/references/data-mapping.md`.

## Using it

- **Scope** (top right): Azure only · Microsoft Services · All consumption; All opps · Inbound only · Exclude Inbound.
- **Filters**: search, customer, status, forecast category, stages (multi-select with counts), solution, fiscal quarter, partner, Focus only, Hide reviewed, Reset. Active filters appear as removable chips.
- **Tabs**: Opportunities, Actions, Consumption, MACC & Commits, Milestones — counts follow the filters.
- **Opportunities**: click an alert card (Overdue close, Closing ≤90d, At-risk commit, Non-Azure consumption, Competitive threat) to filter; review the ACR Actuals and Outlook chart (it follows the Customer filter only) and the sortable table. **Export CSV** exports the rows shown.
- **Milestones**: click a status bar to filter; use the status, commitment, owner, open-only and overdue filters.
- **↗ / Open** opens the record in MSX in your browser. ☆ Focus and ✓ Reviewed are saved only in this browser. Consumed = MSX Consumption Consumed fields; billed-only, AI Business Solutions, Security and Windows and Devices are excluded, and Microsoft Services is shown separately.

Fiscal quarters follow the Microsoft fiscal year (starts 1 July).

## Portfolio scope (managers)

- **My portfolio / My direct reports / Both** (above the filters). Direct reports come from the Dynamics manager hierarchy; tick or untick individual reports. Report-owned rows show an **Owner** column and are **read-only**.
- A banner lists any source that is **Partial** or **Unavailable** (for example a report whose portfolio could not be read, or ACR not connected). Missing data is never shown as zero.
- **Export CSV** is available in every scope; in manager scopes the opportunity export adds an **Owner** column. It contains customer data from your reports' portfolios, so treat the file accordingly. (How this behaves in practice will be reviewed after it has been used.)
- **Refresh** bypasses the cache and re-reads MSX. Otherwise reads are cached per user for 5 minutes and refreshed in the background every 5 minutes while the tab is visible. If a refresh fails, the last good data stays visible and is marked stale.

## Changing MSX (your own opportunities only)

- ✎ on an opportunity adds a dated line to the **forecast comment** (earlier history is kept). On the Milestones tab, ✎ updates status, commitment, date and comment, and ＋ creates a milestone task.
- Every change opens a review dialog that shows the result first; status, commitment and date changes need a reason (recorded in the milestone comment). Nothing is saved until you confirm.
- In sample mode these actions are simulated in memory and write nothing.
- **Managers may not edit.** Report-owned rows are always read-only (the My direct reports view has no edit actions), and there is no manager forecast commit. Only opportunities on your own deal or milestone team can be changed, in My portfolio or Both.
- Teams shows the dashboard read-only.
