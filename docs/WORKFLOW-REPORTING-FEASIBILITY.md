# Scheduled Workflow Reports and On-demand Reporting

**Status: proposed backlog feature; not implemented.** This document records the requested capability and its feasibility. It does not enable a scheduler, report-generation feature, mail transport, permissions, or automatic sending.

## Requested capabilities

| Requirement | Proposed capability | Feasibility |
| --- | --- | --- |
| WFREP-01 | Schedule selected workflows for an authorized portfolio, account, or opportunity scope, with a time zone and pause/resume controls. | Feasible, but reliable unattended execution requires an always-on runner and durable schedules. |
| WFREP-02 | Produce a neatly formatted report containing an executive summary, workflow results, metrics/tables, exceptions, prioritized actions/owners, evidence links, timestamps, and source-health/partial-data warnings. | High. Existing typed workflow outputs and document/Markdown formatting provide reusable building blocks. |
| WFREP-03 | Deliver reports to approved recipients with visible delivery status and failure handling. | Conditional. Opening an Outlook draft is already supported; actual automatic sending needs a separately approved mail service and authorization policy. |
| WFREP-04 | Generate the same report on demand, with preview/download and a separately authorized send action. | High. Reuse the same execution and report-rendering path rather than maintaining a second report format. |

## Existing capabilities and gaps

- The shared [workflow runtime](../packages/orchestrator/workflows/runtime.ts) already starts, tracks, cancels, and retrieves workflow executions. Its active results and completions are in memory; they are not a durable scheduling service.
- [Workflow contracts](../packages/common/contracts/workflows.ts) already define structured scopes, run status, and result types. They explicitly require delegated-user authorization; scheduling must not bypass that boundary with broader application-only MSX access.
- The [VS Code sharing controller](../apps/vscode-extension/src/webview-controller.ts) reuses the desktop [Word document generator](../apps/desktop/electron/main/response-document.ts) and [Outlook draft generator](../apps/desktop/electron/main/outlook-compose.ts).
- Current email handling opens a user-reviewed draft. A successfully opened draft is **not** a sent or delivered email. No automatic sending service should be inferred from these utilities.
- The [VS Code implementation plan](./VSCodeExtension-Implementation-Plan.md#14-explicitly-deferred) explicitly defers unattended workflows that survive VS Code shutdown. A client-side timer alone would not satisfy dependable scheduling.

## Proposed implementation sequence, subject to approval

1. **On-demand reports:** define one shared workflow-result-to-report renderer, accessible preview, and a downloadable Word report. An HTML email body can reuse the same content. Keep sending user-reviewed initially.
2. **Approved delivery:** decide the sender/mailbox, recipient restrictions, human-review policy, and approved sending service. Add auditable accepted/failed delivery states without claiming mail delivery solely from an API acceptance.
3. **Durable scheduling:** introduce an always-on service or worker with persistent schedule/run/delivery records. Desktop, web, and VS Code would manage schedules through the shared product service rather than independent host timers.

These are planning stages, not implemented tasks or an approved infrastructure design.

## Prerequisites and constraints

- **Authorization:** scheduled runs must retain the initiating user's approved data scope and recheck eligibility at execution time. Resolve an approved delegated/background authorization model before unattended live MSX runs. Do not persist or repurpose the current desktop/VS Code access tokens as a shortcut.
- **Mail permissions:** automatic sending requires tenant-approved permissions and a restricted sender/recipient model, for example an approved Microsoft Graph mail integration. Do not re-enable currently disabled Graph composition or request permissions as part of this planning capture.
- **Human review:** the [product principles](./PRD.md#6-product-principles) require review before customer-facing use. Automatic customer communication requires a separately approved policy change; the safer first release is internal reports and user-reviewed drafts.
- **Durability:** store schedules, their owner/scope, workflow versions/parameters, run snapshots, and delivery attempts. Define time-zone/daylight-saving behavior, missed runs, overlap, cancellation, retry/backoff, and duplicate-send prevention.
- **Data boundaries:** honor visible-customer preferences and eligible Deal Team opportunities; do not expand the downstream working set. Protect stored reports and evidence links with appropriate access controls, encryption, retention, and auditing.
- **Failure visibility:** distinguish complete, partial, failed, and unauthorized results. A failed run or send must not appear successful. Define whether partial reports are sent with prominent caveats or held for review.
- **Host availability:** local scheduling can only be a best-effort option while a desktop/VS Code host is running. Execution after host shutdown requires the hosted worker.
- **Formats:** Word and HTML are reasonable initial options based on existing utilities. PDF, multi-workflow aggregation limits, report templates, and recipients remain decisions for the approved specification.

## Acceptance criteria for a future implementation

- Scheduled and on-demand runs use the same authorized execution and report renderer.
- A configured schedule produces the expected report at the selected time, including across restarts and daylight-saving transitions.
- Users can preview/download a readable report and identify its scope, workflow/run IDs, generation time, evidence, and incomplete sources.
- Sending is explicitly authorized, recipient-restricted, auditable, retry-safe, and does not duplicate messages after restart.
- Pause/resume/delete, run and delivery history, and actionable failures are available consistently across the three UIs.
- Tests prove that hidden customers, unauthorized records, secrets, and unsupported automatic writes cannot enter the report or delivery path.

**Overall assessment:** on-demand formatted reporting is highly feasible with the current codebase. Scheduled automatic delivery is technically feasible but has meaningful persistence, hosting, delegated-authentication, mail-permission, and governance prerequisites. No work on this feature has been implemented in this change.
