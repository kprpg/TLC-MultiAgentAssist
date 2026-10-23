---
name: stage-pipeline-review-dashboard
description: "Generate, extend, or validate the Stage and Pipeline Review dashboard (a child tab of the Dashboards pane; formerly the 'Azure Consumption Command Center' reference screenshots). Use when: building or changing its scope toggles, filters, alert cards, ACR Actuals and Outlook chart, opportunity/actions/consumption/MACC/milestone tabs, sample fixture, or Zod contract; mapping it to live MSX/Dataverse data; or checking it against reference screenshots."
---

# Stage and Pipeline Review dashboard

A consumption-focused pipeline review for account teams: which Azure (and Microsoft Services)
consumption opportunities are overdue, closing soon, at risk, mis-tagged or threatened, how ACR is
tracking against target, and what the milestones underneath look like.

## Where things live

| Layer | Path |
| --- | --- |
| UI (shared by Desktop, Web, VS Code webview, Teams) | `apps/shared/dashboards/StageAndPipelineReview/` |
| Registration (child tab "Stage and Pipeline Review") | `apps/shared/dashboards/dashboard-workspace.tsx` |
| CSS imports (one per surface entry) | `apps/desktop/renderer-revamp/src/main.tsx`, `apps/vscode-extension/src/webview/main.tsx`, `apps/teams/src/client/main.tsx` |
| Contract (browser-safe Zod, `stagePipelineReviewContractVersion`) | `packages/common/contracts/stage-pipeline-review.ts` |
| Fictitious sample snapshot | `packages/common/fixtures/stage-pipeline-review.ts` |
| Tests | `tests/contract/stage-pipeline-review.test.ts`, `tests/unit/shared/stage-pipeline-review.test.ts`, `tests/e2e/revamp/stage-pipeline-review.spec.ts` |

## Workflow

1. Read [references/dashboard-spec.md](references/dashboard-spec.md) for the exact UI, filters and derived-metric rules.
2. Read [references/data-mapping.md](references/data-mapping.md) before touching the contract or wiring live data.
3. Pick a ready-made request from [references/prompts.md](references/prompts.md) (generate, add filter, add tab, live wiring, screenshot parity check).
4. Change in this order: contract → fixture → `stage-pipeline-analysis.ts` (pure, unit-tested) → components → CSS → tests.
5. Validate: `npx vitest run tests/contract/stage-pipeline-review.test.ts tests/unit/shared/stage-pipeline-review.test.ts`,
   `npm run typecheck`, `npx eslint apps/shared/dashboards`, and for UI changes
   `npx playwright test tests/e2e/revamp/stage-pipeline-review.spec.ts --config playwright.revamp.config.ts`
   (build first: `node node_modules/vite/bin/vite.js build --config apps/desktop/vite.revamp.config.ts`).

## Non-negotiable rules

- **Contracts first**: every datum crosses the strict Zod schema; bump `stagePipelineReviewContractVersion` and the contract test when the wire shape changes.
- **Pure analysis**: all filtering, counting, alert, ACR and CSV logic belongs in `stage-pipeline-analysis.ts`, not in components. Components render and dispatch only.
- **Sample + live parity**: sample mode (fictitious fixture, no network) must always work. Live data must come through an orchestrator operation identical on Electron IPC, HTTP and the webview bridge; do not fetch MSX from the UI.
- **Read-only**: no CRM writes. "Open in MSX" is an HTTPS link (`msxRecordUrl`); Focus and Reviewed marks live only in browser `localStorage`.
- **Untrusted text**: opportunity names, notes and milestone comments render as text only (never HTML). CSV export neutralises formula-leading cells (`csvCell`).
- **No private data in code**: fixtures, tests, screenshots and docs contain only fictitious names/amounts. Never copy values from reference screenshots; never log customer names or amounts to telemetry.
- **Three-surface parity**: the pane is shared; if a surface needs CSS, import `stage-pipeline-review.css` in its entry point.
- **Honest unknowns**: do not invent fields. Where an MSX field is not yet confirmed (see data-mapping), say so rather than guessing a logical name.
