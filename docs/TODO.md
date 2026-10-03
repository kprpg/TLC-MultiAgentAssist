# TLC follow-up work

## Prioritized backlog

> Planning capture only. Do not implement these items until they are explicitly approved and scoped.

1. [ ] Fix SharePoint access.
2. [ ] Revamp the UI.
3. [ ] Connect to LinkedIn.
4. [ ] Connect to Seismic.
5. [ ] Evaluate deploying the UI as a static web page hosted in an Azure Storage account.
6. [ ] Fix the desktop E2E email-dialog flow: the milestone and tooltip assertions pass, but the broader `test:smoke:revamp:desktop` test fails because the existing email dialog does not open.
7. [ ] Fix the root TypeScript configuration for VS Code extension TSX imports: `npm run typecheck` currently fails with JSX-disabled `TS6142` errors.
8. [ ] Evaluate automating repeatable Specialist / SSP forecast-hygiene work, starting with forecast comments.
	- Make the experience more autonomous by detecting stale or incomplete opportunity information and identifying the responsible user.
	- Notify responsible users through Teams or email with the evidence, proposed update, and required action.
	- Assess a closed-loop flow that drafts context-grounded updates or comments and supports review and approval before writing to MSX, reducing manual maintenance.
	- Define eligibility rules, evidence requirements, ownership, audit history, and escalation behavior before enabling any automated write.
9. [ ] Evaluate a Scout-like dashboard and workflow for opportunity-maintenance needs.
	- Identify stale opportunity data, outdated forecast comments, stage issues, expired due dates, missing stakeholder maps, and other actionable gaps.
	- Determine the responsible Account Executive, manager, Solution Engineer, Specialist / SSP, or other owner for each issue.
	- Notify the responsible person through Teams or email, optionally initiate a chat, and provide an actionable script listing the affected opportunities, identified issues, and specific recommended updates.
	- Apply the existing skill-backed forecast-comment pattern, which requires approval before changing the record, to additional eligible maintenance actions.
10. [ ] Add scheduled workflow execution, neatly formatted report generation and delivery, and on-demand report generation.
	- **Status: proposed; not implemented.** See the [feature and feasibility assessment](./WORKFLOW-REPORTING-FEASIBILITY.md).
	- On-demand reports are highly feasible by reusing existing workflow results and document/email-draft formatting.
	- Reliable unattended scheduling needs a durable, always-on runner; desktop and VS Code timers cannot run when their hosts are closed.
	- Automatic sending is conditional on approved mail permissions, recipient policy, delegated data access, and changes to the current user-reviewed draft-only boundary.

## Improve Foundry agent interaction

- [x] Replace the single pre-populated prompt with four domain-relevant starter prompt choices for each agent.
- [x] Submit a starter prompt immediately when selected while preserving freeform prompt entry and keyboard accessibility.
- [x] Render agent responses in a safe Markdown viewer with readable headings, lists, links, tables, quotes, and code blocks.
- [x] Add automated regression coverage for prompt selection, submission, agent switching, and Markdown rendering.

## Improve workbench focus and response handoff

- [x] Add accessible VS Code-style toolbar toggles for the working-context and next-best-actions panes.
- [x] Persist each pane preference and expand the central workbench when either pane is collapsed.
- [x] Add a completed-response action group for opening an addressed Outlook message and exporting a Word document.
- [x] Open Outlook compose through validated main-process IPC without Graph mail permissions; leave sending to the user.
- [x] Export structured agent Markdown through Electron's save dialog as a valid `.docx` file.
- [x] Add automated regression coverage for pane state, Outlook compose URI shape, export document structure, IPC validation, and response controls.

## Restore canonical MCEM knowledge access

- Current project input: `docs/knowledge/MCEM Overview.pdf`.
- Treat this file as a local, point-in-time overview snapshot, not canonical or complete MCEM guidance.
- Keep direct Microsoft Graph and SharePoint access disabled in active application composition.
- Revisit the canonical MCEM SharePoint source after tenant-approved delegated access is available.
- Before re-enabling live access, map the maintained FY27 source-of-truth assets, add freshness/version checks, and retain an explicit degraded local-snapshot mode.
