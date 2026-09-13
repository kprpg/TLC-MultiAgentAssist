# Dataverse + MSX MCP Merged Decision Brief

Status: Draft for review
Date: 2026-09-12
Type: Planning only (no implementation)
Scope: Connector strategy, agent model, workflow exposure, UI layout, engineering guardrails, phased rollout
Source inputs: docs/DataverseMCP.md, docs/DataverseMCP-opus.md

## 1) Executive Decision Summary

This brief merges product readability with strict engineering controls.

Decisions:

1. Use two MCP tiers:
   - Dataverse MCP for broad, schema-discoverable, exploratory and operational asks.
   - MSX MCP for curated, deterministic, seller-focused tasks.
2. Route deterministically:
   - Prefer MSX MCP when a curated tool exists.
   - Fall back to Dataverse MCP for broader asks and discovery paths.
3. Keep current four agents for synthesis, and add capability incrementally:
   - Phase option A: deterministic workflow engine first.
   - Phase option B: add specialist capabilities (Portfolio Navigator, Relationship Map, Action Broker).
4. Expose workflows through explicit UI surfaces (Workflow Launcher, Operational Queue, contextual workflow panel) while keeping the current blade model intact.
5. Treat security and policy controls as non-negotiable release gates.

## 2) Context and Problem Statement

Current state strengths:

- Strong opportunity-level guidance with four existing capabilities.
- Existing contracts, source-health patterns, and trusted-process token isolation are in place.
- A usable desktop shell with established interaction patterns already exists.

Current state gap:

- Most flows are opportunity-scoped and cannot natively answer portfolio-level and cross-entity operating questions.
- Broad asks require wider entity access, lineage, and guardrails beyond current hand-shaped connector methods.

Why this matters:

- Sellers need both high-frequency deterministic flows and broader insight workflows.
- A single connector style cannot optimize for both exploration and strict execution paths.

## 3) Architecture Approach (Best of Both)

### 3.1 Connector split

Dataverse MCP (broad tier):

- Schema discovery and broad query patterns.
- Cross-entity operations, hygiene and exception workflows, and exploratory asks.
- Higher flexibility, higher guardrail demand.

MSX MCP (narrow tier):

- Curated business tools for opportunity/account/pipeline execution.
- Stable typed responses and lower-latency deterministic behavior.
- Preferred path for repeatable seller workflows.

### 3.2 Runtime placement

Primary recommendation:

- Run MCP client in the trusted process (Electron main and web BFF), with orchestrator-controlled tool brokerage.

Secondary option (future, selective):

- Foundry-hosted MCP only where justified by long-running exploratory scenarios and after explicit governance review.

### 3.3 Routing policy

1. Deterministic workflow card click: deterministic router, no model-decided routing.
2. Curated tool exists: use MSX MCP.
3. Curated tool missing or broad ask: Dataverse MCP with guardrails.
4. Composite ask: Dataverse retrieval first, MSX enrichment second.
5. If latency budget is exceeded: return partial deterministic output and offer deeper analysis action.

## 4) Non-Negotiable Engineering Guardrails

These controls are mandatory for any release.

### 4.1 Identity, access, and scope

- Delegated user identity only for customer data access.
- Mandatory row-scope predicates for non-reference entities.
- No access broadening beyond signed-in user portfolio boundaries.

### 4.2 Tool policy and safety

- Default deny policy for MCP tools.
- Unknown tools are blocked until explicitly reviewed.
- Destructive tools (delete/schema mutation) remain hard-blocked.
- Write tools are approval-gated and disabled by default.

### 4.3 Query and model safety

- No raw model-authored SQL/OData/FetchXML accepted directly.
- Structured guarded query shape only.
- Enforced entity allowlist, column allowlist, and row caps.
- Tool result content is treated as untrusted data, never executable instruction.

### 4.4 Token and data handling

- Tokens remain in trusted process only.
- Renderer receives contract-validated envelopes only.
- Restricted fields are stripped before model prompt inclusion.
- Journal and telemetry store ids/counts/latency, not raw sensitive payloads.

### 4.5 Write governance

- Agent proposes change sets only.
- User reviews and explicitly approves itemized changes.
- Conflicts are re-read and reported before apply.
- Every applied change emits an audit note.

## 5) Agent and Capability Strategy

### 5.1 Baseline

Retain existing synthesis capabilities:

- Account Pulse
- MCEM Coach
- Pursuit and Executive
- Risk and Solution Play

### 5.2 Expansion options

Option A (lower complexity, faster stabilization):

- Add deterministic workflow engine first.
- Keep existing four for synthesis.

Option B (broader long-term capability):

- Add Portfolio Navigator for portfolio/account insight workloads.
- Add Relationship Map for stakeholder and engagement workflows.
- Add Action Broker for governed write proposals and change-set creation.

Recommendation:

- Start with Option A through deterministic value proof, then promote to Option B based on adoption and latency KPIs.

## 6) Workflow Exposure Model

### 6.1 Workflow surfaces

- Workflow Launcher: primary entry point for named plays/workflows.
- Operational Queue: right-rail work queue from workflow outputs.
- Contextual Workflow Panel: account/opportunity-scoped workflow execution.

### 6.2 Interaction principles

- One-click run for defaulted deterministic plays.
- Progressive disclosure for advanced parameters.
- Progressive rendering for long-running paths.
- Explicit state labels: complete, partial, unauthorized.
- One-click handoff from deterministic output to deeper guidance.

### 6.3 Initial workflow cohort

Deterministic first cohort:

- stale opportunity sweep
- overdue milestone triage
- weekly governance exceptions
- commit-risk conflict list
- owner workload imbalance
- activity follow-up debt

Composite/agentic cohort:

- stage-evidence mismatch queue
- next-meeting prep pack
- stage exit evidence packet

## 7) UI Layout Plan (Readable but Concrete)

### 7.1 Layout changes

- Add Workflows entry to left rail.
- Add Workflow Runs to right rail alongside actions.
- Preserve existing center tabs and add workflow panel where context is active.

### 7.2 Scope model

- Explicit scope hierarchy: Portfolio -> Account -> Opportunity.
- Scope controls visible in command bar.
- Scope drives available workflows and enabled capabilities.

### 7.3 Trust and clarity UI elements

- Tool activity drawer shows what ran, row counts, truncation, and timings.
- Approval sheet for writes shows field-level before/after, rationale, and evidence links.
- Typed result cards (metric strip, record table, stakeholder map, timeline, action list, change set) preferred over markdown-only output.

## 8) Contracts and Schema Direction

### 8.1 Contract evolution

- Maintain backward compatibility for current opportunity-scoped request paths.
- Introduce scope-aware request model for portfolio and account scenarios.
- Expand evidence/source enums to represent MCP-originated lineage.

### 8.2 Internal schemas to standardize

- MCP server registry schema
- Tool policy schema
- Dataverse semantic mapping schema
- Guarded query request schema
- Tool invocation journal schema
- Workflow definition and workflow run schemas
- Change-set proposal/approval/result schemas

### 8.3 Compatibility rule

- Legacy request formats remain accepted during migration window and normalize into the new scope model.

## 9) Testing and Quality Gates

Required test layers:

- Schema validation and strict unknown-key rejection.
- Policy invariants (default deny, write approval requirements, destructive blocks).
- Query guard tests (scope predicate enforcement, allowlist and cap behavior).
- Connector behavior tests for retries, timeout, cancellation, and health.
- Contract compatibility tests for legacy request normalization.
- Integration tests with fixture MCP connectors in sample mode.
- E2E tests for workflow launcher, scope switching, activity drawer, and approval sheet.

Release quality gates:

1. Deterministic workflow reliability and latency within agreed thresholds.
2. Explicit unauthorized and partial-state UX validated.
3. No regression on existing desktop core journeys.
4. Guardrails proven through policy and security tests.

## 10) Telemetry and KPIs

Core telemetry:

- MCP connect/tool-call latency
- guard reject and truncation counts
- workflow run latency and outcome state
- first-card render time
- change-set apply outcomes

Core KPIs:

- workflow adoption rate
- time-to-action
- guidance conversion rate
- stale queue reduction
- deterministic vs agentic cost/latency ratio

## 11) Rollout Plan

Phase A: Foundations

- MCP transport, policy schemas, semantic mapping, guarded query primitives, telemetry, fixtures.

Phase B: Read-only curated tier

- MSX MCP read paths integrated into trusted process orchestration.

Phase C: Broad tier + portfolio scope

- Dataverse MCP read paths, scope-aware contracts, portfolio workflows, workflow launcher surfaces.

Phase D: Relationship intelligence

- Stakeholder/engagement workflows and corresponding UI cards.

Phase E: Governed action

- Change-set workflow and approval sheet; write tools remain flag-gated and approval-enforced.

Rollout posture:

- Flags off by default.
- Sample mode first.
- Read-only pilot before wider deployment.
- Write enablement as a separate decision gate.

## 12) Risks and Mitigations

| Risk ID | Risk                                                    | Probability | Impact | Mitigation                                                                     |
| ------- | ------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------ |
| R-01    | Dataverse/MSX overlap causes contradictory output       | Medium      | High   | Connector precedence rules, lineage visibility, partial-state reconciliation   |
| R-02    | Workflow sprawl hurts discoverability                   | High        | Medium | Persona default sets, progressive disclosure, curated launcher                 |
| R-03    | Composite latency degrades UX                           | Medium      | High   | Staged execution, cache, progressive rendering, partial deterministic fallback |
| R-04    | Users misread deterministic output as strategy guidance | Medium      | Medium | Explicit labeling, guided handoff to deeper analysis                           |
| R-05    | Unauthorized appears as empty data                      | Medium      | High   | Mandatory auth-state rendering and connector-level failure clarity             |
| R-06    | Contract drift breaks UI                                | Medium      | High   | Versioned schemas, compatibility window, contract tests                        |
| R-07    | Premature over-agentization increases cost and delay    | Medium      | Medium | Deterministic-first gate and capability rollout by measured value              |

## 13) Open Decisions Requiring Approval

1. Expansion track now or later:
   - Option A deterministic-first only
   - Option B immediate specialist capability expansion
2. Scope of initial UI launch:
   - workflow launcher only
   - launcher plus full queue and typed cards
3. Write path timeline:
   - hold write flows until read-only KPIs pass
   - pilot write flows under strict approval earlier
4. Preferred persistence for workflow runs:
   - local only
   - remote only
   - hybrid

## 14) Final Recommendation

Proceed with a deterministic-first release path that preserves trusted-process enforcement and strict MCP tool policy controls, while shipping user-facing workflow clarity early.

In short:

- Adopt the readable planning flow from DataverseMCP.
- Enforce opus guardrails as release-blocking requirements.
- Sequence value delivery from deterministic workflows to broader relationship intelligence and finally governed writes.
