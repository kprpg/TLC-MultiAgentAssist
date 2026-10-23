# Stage and Pipeline Review

A read-only dashboard under **Dashboards → Stage and Pipeline Review** (Desktop, Web, VS Code, Teams).
It shows consumption opportunities by MCEM stage with alerts, ACR coverage and milestones.

> **Data today:** the dashboard renders a clearly labelled **synthetic sample**. Live MSX/MSXi data
> is a documented follow-up (see `.github/skills/stage-pipeline-review-dashboard/references/data-mapping.md`).

## Using it

- **Scope** (top right): Azure only · Microsoft Services · All consumption; All opps · Inbound only · Exclude Inbound.
- **Filters**: search, customer, status, forecast category, stages (multi-select with counts), solution, fiscal quarter, partner, Focus only, Hide reviewed, Reset. Active filters appear as removable chips.
- **Tabs**: Opportunities, Actions, Consumption, MACC & Commits, Milestones — counts follow the filters.
- **Opportunities**: click an alert card (Overdue close, Closing ≤90d, At-risk commit, Non-Azure consumption, Competitive threat) to filter; review the ACR Actuals and Outlook chart (it follows the Customer filter only) and the sortable table. **Export CSV** exports the rows shown.
- **Milestones**: click a status bar to filter; use the status, commitment, owner, open-only and overdue filters.
- **↗ / Open** opens the record in MSX in your browser. ☆ Focus and ✓ Reviewed are saved only in this browser. Consumed = MSX Consumption Consumed fields; billed-only, AI Business Solutions, Security and Windows and Devices are excluded, and Microsoft Services is shown separately.

The dashboard never writes to MSX. Fiscal quarters follow the Microsoft fiscal year (starts 1 July).
