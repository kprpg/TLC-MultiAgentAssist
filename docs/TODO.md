# TLC follow-up work

## Prioritized backlog

> Planning capture only. Do not implement these items until they are explicitly approved and scoped.

1. [ ] Fix SharePoint access.
2. [ ] Revamp the UI.
3. [ ] Connect to LinkedIn.
4. [ ] Connect to Seismic.
5. [ ] Evaluate deploying the UI as a static web page hosted in an Azure Storage account.

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
