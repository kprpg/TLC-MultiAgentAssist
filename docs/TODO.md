# TLC follow-up work

## Improve Foundry agent interaction

- [x] Replace the single pre-populated prompt with four domain-relevant starter prompt choices for each agent.
- [x] Submit a starter prompt immediately when selected while preserving freeform prompt entry and keyboard accessibility.
- [x] Render agent responses in a safe Markdown viewer with readable headings, lists, links, tables, quotes, and code blocks.
- [x] Add automated regression coverage for prompt selection, submission, agent switching, and Markdown rendering.

## Restore canonical MCEM knowledge access

- Current project input: `docs/knowledge/MCEM Overview.pdf`.
- Treat this file as a local, point-in-time overview snapshot, not canonical or complete MCEM guidance.
- Keep direct Microsoft Graph and SharePoint access disabled in active application composition.
- Revisit the canonical MCEM SharePoint source after tenant-approved delegated access is available.
- Before re-enabling live access, map the maintained FY27 source-of-truth assets, add freshness/version checks, and retain an explicit degraded local-snapshot mode.