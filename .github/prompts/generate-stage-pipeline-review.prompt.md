---
description: "Generate or update the Stage and Pipeline Review dashboard (Dashboards child tab) from reference screenshots, using the stage-pipeline-review-dashboard skill."
---

Use the `stage-pipeline-review-dashboard` skill (`.github/skills/stage-pipeline-review-dashboard/SKILL.md`).

Goal: ${input:goal:Generate or update the Stage and Pipeline Review dashboard from the attached screenshots}

1. Analyze the attached screenshots (or the existing spec in `references/dashboard-spec.md` when none are attached): header, scope toggles, every filter and its options, active-filter chips, tabs and count rules, alert cards, KPIs, charts, tables, row actions, footer.
2. Implement or update, in order: Zod contract → fictitious fixture → pure analysis helpers → components → CSS → tests, under `apps/shared/dashboards/StageAndPipelineReview/` and registered as a child tab of the Dashboards pane (`dashboard-workspace.tsx`).
3. Keep sample mode working, never copy private data from screenshots, render untrusted text as text, and keep the dashboard read-only.
4. Validate with the contract/unit tests, `npm run typecheck`, `npx eslint apps/shared/dashboards`, and the Playwright spec; report changed files, results, and assumptions for any tab without a screenshot.
