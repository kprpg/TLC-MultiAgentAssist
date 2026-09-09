---
name: code-review
description: "Review pull requests and code changes in TLC MultiAgent Assist. Use when: reviewing a PR, checking a diff, requesting code review, assessing merge readiness, or looking for regressions, security issues, and missing tests."
---

# Code Review

Review changes as a senior TypeScript, React, Electron, and Node.js engineer. Focus on defects and merge risk rather than summarizing the diff.

## Review Priorities

1. Identify correctness bugs, runtime failures, race conditions, stale state, and invalid assumptions.
2. Check security boundaries, especially authentication, authorization, token handling, Electron IPC, external URLs, file access, and untrusted connector data.
3. Verify shared contracts and Zod schemas remain compatible across apps, connectors, agents, and the orchestrator.
4. Check React behavior for incorrect state ownership, missing cleanup, null handling, accessibility regressions, and unstable UI tests.
5. Require an automated regression test for every bug fix. Flag new behavior that lacks focused unit, integration, or end-to-end coverage.
6. Check errors for actionable context without leaking tokens, customer data, or internal credentials.
7. Treat files under `apps/desktop/dist-electron/` as generated output. Review their source files first and flag generated changes that do not match the source or should be rebuilt.

## Project Checks

- Use `npm run phase0:check` for the full structure, preflight, lint, typecheck, and unit-test gate.
- Prefer the narrowest relevant Vitest or Playwright test while investigating a finding.
- For desktop or Electron changes, consider `npm run desktop:build` and the relevant smoke test.
- For web changes, consider `npm run web:build` and release smoke coverage when packaging behavior changes.
- Do not run live tests unless their required credentials and explicit live-test flags are available.

## Review Method

1. Read the PR description and changed files.
2. Trace each behavioral change to its owning implementation, callers, contracts, and tests.
3. Validate suspected defects against nearby code or a focused executable check before reporting them.
4. Report only actionable findings caused or exposed by the change. Do not report style preferences already covered by ESLint.
5. If no defects are found, say so and note any validation or coverage gaps.

## Output Format

List findings first, ordered by severity:

- **Critical**: credential exposure, data loss, remote-code execution, or a broadly unusable application.
- **High**: likely production failure, authorization bypass, contract break, or major regression.
- **Medium**: user-visible defect, unreliable workflow, or meaningful missing validation.
- **Low**: narrow maintainability risk with a concrete future failure mode.

For each finding, include:

- A concise title with severity.
- The affected file and line.
- The specific failure scenario and impact.
- A minimal direction for correction.

Keep summaries brief and place them after findings. Do not approve a PR solely because automated checks pass.