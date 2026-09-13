# Dataverse + MSX MCP Execution Sequence

Status: Planning only (no implementation)
Date: 2026-09-12
Companion to: docs/DataverseMCP.md

## Goal

Deliver Dataverse MCP and MSX MCP expansion in controlled increments, while preserving current UX quality, source governance, and agent reliability.

## Delivery Strategy

- Sequence deterministic workflow foundations first.
- Add composite and agentic orchestration only after baseline reliability is met.
- Gate each phase with explicit acceptance criteria before moving forward.

## Phase Plan

### Phase 0: Architecture and Contract Baseline

Duration target: 1 sprint

Primary outcomes:

- Finalize connector domain split (Dataverse broad ops, MSX seller-critical path).
- Freeze normalized internal schemas:
  - workflow-definition
  - workflow-run
  - evidence-envelope v2
  - safe query-template
- Define routing policy and precedence rules for conflicting signals.
- Define UI IA for Workflow Launcher and Operational Queue.

Exit criteria:

- Architecture note approved.
- Contract schemas versioned and review-signed.
- Security/governance checklist approved for read-only rollout.

### Phase 1: Deterministic Workflow MVP

Duration target: 1 to 2 sprints

Primary outcomes:

- Ship deterministic workflow registry and run lifecycle.
- Enable first workflow cohort:
  - WF-001 stale opportunity sweep
  - WF-002 overdue milestone triage
  - WF-005 weekly governance exceptions
  - WF-006 commit-risk conflict list
  - WF-009 owner workload imbalance
  - WF-010 activity follow-up debt
- Add UI surfaces:
  - Workflows entry in left nav
  - Workflow Launcher page
  - Workflow Runs tab in right rail

Exit criteria:

- P50 runtime < 6s for deterministic runs.
- Partial and unauthorized states are visible and actionable.
- Users can run workflows without entering the guidance chat.
- No regression in existing account/opportunity blade flows.

### Phase 2: Composite Connector Orchestration

Duration target: 1 sprint

Primary outcomes:

- Enable orchestrated Dataverse + MSX composite runs.
- Add staged execution pipeline:
  - broad Dataverse retrieval
  - MSX enrichment
  - normalized merge
- Enable second workflow cohort:
  - WF-003 stage-evidence mismatch queue
  - WF-007 next-meeting prep pack
  - WF-012 stage exit evidence packet

Exit criteria:

- Composite workflows return complete or partial with explicit source lineage.
- Source health is shown per connector for every run.
- P50 end-to-end latency for composite runs < 10s for deterministic core payload.

### Phase 3: Agentic Workflow Layer

Duration target: 1 sprint

Primary outcomes:

- Decide and implement one of two planning tracks:
  - Track A: deterministic orchestrator first, no new LLM agent.
  - Track B: add Workflow Orchestrator Agent and Portfolio Operations Agent.
- Integrate "Send to Guidance" transition from workflow output to existing 4 agents.
- Introduce compact run-card summaries in workbench.

Exit criteria:

- User can pivot from deterministic output to strategic guidance in 1 click.
- Agent invocation consumes workflow-normalized context with citation integrity.
- Existing 4 agents maintain output quality and response contract conformance.

### Phase 4: Leadership and Portfolio Intelligence

Duration target: 1 sprint

Primary outcomes:

- Enable high-level portfolio intelligence workflows:
  - WF-008 pipeline concentration risk
  - WF-011 opportunity dependency graph
- Add manager-focused quick filters and saved views.
- Add adoption telemetry dashboards for workflow utilization and action conversion.

Exit criteria:

- Leadership views support drill-down from portfolio signal to specific opportunity action.
- KPI reporting available for adoption, time-to-action, and queue reduction.

## Critical Decision Gates

Gate G0 (end of Phase 0):

- Approve schema-first contract model and connector split.

Gate G1 (end of Phase 1):

- Confirm deterministic workflows deliver meaningful user value without agent dependence.

Gate G2 (end of Phase 2):

- Confirm composite orchestration quality and acceptable latency.

Gate G3 (start of Phase 3):

- Choose Track A (no new agent yet) or Track B (add 2 specialist agents).

Gate G4 (end of Phase 4):

- Approve expansion from desktop-first to web parity rollout.

## Acceptance Criteria Summary

Functional:

- Workflows are discoverable, runnable, and context-aware.
- Results include citations, source health, and state visibility.
- Composite workflows preserve deterministic lineage.

Non-functional:

- Deterministic P50 < 6s, composite deterministic core P50 < 10s.
- No blocking UI on long-running operations.
- Consistent error states for unavailable and unauthorized sources.

Trust and governance:

- Read-only by default for expanded connectors.
- No hidden data broadening beyond signed-in delegated permissions.
- Audit trail for run start, connector calls, state transitions, and follow-on actions.

## Suggested Milestone Sequence (Simple)

1. M0: Contracts + IA approved.
2. M1: Deterministic workflow cohort live in Workflow Launcher.
3. M2: Composite Dataverse+MSX cohort live with source lineage.
4. M3: Agentic pivot flow live (Track A or B).
5. M4: Leadership workflows + telemetry dashboards live.

## Dependencies

- Dataverse MCP query capability and metadata reliability.
- MSX MCP narrow-path operations and stable response envelope.
- Orchestrator routing policy support for deterministic vs agentic paths.
- UI support for new nav surface and right-rail run queue.

## Risks to Watch During Execution

- Domain overlap causing contradictory outputs.
- Workflow sprawl reducing discoverability.
- Composite latency drift and user abandonment.
- Over-agentization of deterministic asks.

## Risk Matrix

| Risk ID | Risk                                                                         | Probability | Impact | Owner                    | Trigger                                                                  | Contingency                                                                                  |
| ------- | ---------------------------------------------------------------------------- | ----------- | ------ | ------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| ER-01   | Domain overlap causes contradictory outputs in Phase 2                       | Medium      | High   | Architecture lead        | Increased reconciliation errors in composite runs                        | Pause new composite workflows, enforce source precedence, release patch with lineage banners |
| ER-02   | Workflow launcher becomes noisy after Phase 1 rollout                        | High        | Medium | Product/UX lead          | Drop in workflow run-through and completion ratio                        | Cut visible defaults to top persona workflows, move remainder to advanced catalog            |
| ER-03   | Composite latency misses SLA and reduces adoption                            | Medium      | High   | Orchestrator lead        | P50/P95 latency breaches over two consecutive checkpoints                | Return deterministic core first, queue deep analysis asynchronously                          |
| ER-04   | Authorization states are not clear in user-facing output                     | Medium      | High   | Security lead            | Support tickets where users interpret unauthorized as no-data            | Require connector-level auth block, standardized unauthorized copy in all run cards          |
| ER-05   | Agent expansion (Track B) adds complexity before proving deterministic value | Medium      | Medium | Program lead             | Gate G3 triggered without meeting G1/G2 quality and adoption thresholds  | Hold Track B, continue Track A deterministic path until metrics stabilize                    |
| ER-06   | Contract/schema changes break UI rendering in later phases                   | Medium      | High   | Platform lead            | Increase in contract parsing or rendering errors after schema increments | Contract version pinning, compatibility adapter, release gate requiring contract test pass   |
| ER-07   | Governance drift introduces accidental write-capable behavior                | Low         | High   | Security/Governance lead | Detection of non-read-only workflow path in audit                        | Immediate feature flag rollback, disable write pathways, run post-incident review            |

## Recommended Starting Point

Start with Phase 1 deterministic workflows and Gate G1 validation, then decide whether to add specialist agents based on measured usage and latency rather than assumptions.
