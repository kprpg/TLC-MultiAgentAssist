# Dataverse + MSX MCP Merged Decision Brief

Status: Approved implementation plan; execution in progress
Date: 2026-09-12
Type: Implementation specification and execution ledger
Scope: Connector strategy, agent model, workflow exposure, UI layout, engineering guardrails, phased rollout
Source inputs: docs/DataverseMCP.md, docs/DataverseMCP-opus.md

## 1) Executive Decision Summary

This brief merges product readability with strict engineering controls.

Decisions:

1. Use two logical MCP tool tiers over the environment MCP topology discovered at deployment time:
   - Dataverse tools for broad, schema-discoverable, exploratory and operational asks.
   - MSX plugin tools for curated, deterministic, seller-focused tasks.
   - Do not infer separate physical servers from these logical tiers. The documented Dataverse endpoint
     is `https://{org}.crm.dynamics.com/api/mcp`; a second endpoint is configured only when capability
     discovery or an authoritative service contract proves that it exists.
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

Dataverse tool family (broad tier):

- Schema discovery and broad query patterns.
- Cross-entity operations, hygiene and exception workflows, and exploratory asks.
- Higher flexibility, higher guardrail demand.

MSX plugin tool family (narrow tier):

- Curated business tools for opportunity/account/pipeline execution.
- Stable typed responses and lower-latency deterministic behavior.
- Preferred path for repeatable seller workflows.

The connector names `dataverse-mcp` and `msx-mcp` are stable logical identities used for routing,
policy, lineage, and result normalization. They may share one authenticated MCP client and physical
endpoint. Production startup must discover tools and bind each logical operation to an advertised
tool name and input schema; missing or changed tools fail closed.

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

## 13) Locked Delivery Decisions

The following defaults remove approval pauses during implementation. A later change requires a new
decision record and must not silently expand the current scope.

1. Expansion track: Option A, deterministic-first. No new LLM agent is added before Gate G3.
2. Initial UI: Workflow Launcher first. The operational queue and typed result cards follow after
   launcher behavior and state handling pass Gate G2.
3. Writes: held until read-only KPIs and all security gates pass. Write code remains disabled by
   default and cannot be activated by configuration alone before Gate G5.
4. Persistence: local bounded run history first. Remote persistence is deferred until its data
   retention and authorization model has a separate decision record.
5. Runtime placement: trusted-process MCP client only. Foundry-hosted MCP is out of the initial
   implementation scope.
6. Rollout: sample mode first, then read-only live pilot behind independent connector and UI flags.

## 14) Final Recommendation

Proceed with a deterministic-first release path that preserves trusted-process enforcement and strict MCP tool policy controls, while shipping user-facing workflow clarity early.

In short:

- Adopt the readable planning flow from DataverseMCP.
- Enforce opus guardrails as release-blocking requirements.
- Sequence value delivery from deterministic workflows to broader relationship intelligence and finally governed writes.

## 15) Implementation Operating Model

### 15.1 Status vocabulary

Every work item below has one status:

- `NOT STARTED`: no production code has been changed for the item.
- `IN PROGRESS`: implementation or its focused tests are being changed.
- `BLOCKED`: an external dependency prevents completion; the item records concrete evidence.
- `COMPLETE`: acceptance criteria pass and validation evidence is recorded.

Work proceeds in numeric order. An item may start only when all listed dependencies are `COMPLETE`.
The smallest focused test for the changed behavior runs immediately after each substantive edit.
Broader phase validation runs only after all items in that phase pass their focused checks.

### 15.2 Definition of done

An item is complete only when:

1. Runtime code and configuration use strict, versioned contracts.
2. Positive, boundary, malformed-input, and security-invariant tests appropriate to the item pass.
3. Existing public behavior remains backward compatible unless this document explicitly versions it.
4. Errors preserve a stable category without leaking tokens, raw restricted records, or transport bodies.
5. Feature flags default off for live MCP access.
6. The item's validation command and result are recorded in Section 18.
7. This ledger is updated in the same change as the implementation.

### 15.3 Validation tiers

| Tier | Purpose                                | Required command                                               |
| ---- | -------------------------------------- | -------------------------------------------------------------- |
| V0   | Focused behavior                       | `npm test -- <test-file>`                                      |
| V1   | Package type safety                    | `npm run typecheck`                                            |
| V2   | Repository unit/integration regression | `npm test`                                                     |
| V3   | Static policy and style                | `npm run lint && npm run check:structure && npm run preflight` |
| V4   | Desktop journey                        | `npm run test:smoke:revamp:desktop`                            |
| V5   | Web journey                            | `npm run web:build` plus the relevant web E2E test             |

Tests requiring a live Dataverse or MSX service are never release substitutes for fixture-backed
tests. Live tests are opt-in, read-only, and skipped unless their explicit environment flag is set.

## 16) Ordered Implementation Ledger

### Phase A - Contracts, configuration, and policy

#### A0 - Convert the decision brief into an implementation specification

- Status: `COMPLETE`
- Dependencies: none
- Deliverables: locked defaults, ordered ledger, quality gates, test matrix, rollback rules, and
   evidence log in this document.
- Acceptance: every later item has a bounded scope and an executable completion check.

#### A1 - Add foundational MCP configuration schemas

- Status: `COMPLETE`
- Dependencies: A0
- Files: `packages/common/configuration/mcp-servers.ts`,
   `packages/common/configuration/mcp-tool-policy.ts`, `packages/common/index.ts`,
   `config/mcp.servers.json`, `config/mcp.tool-policy.json`.
- Behavior: strict v1 schemas for server registry and default-deny tool policy; HTTPS-only URLs;
   delegated Entra authentication; bounded timeouts, concurrency, rows, bytes, retry, and circuit
   breaker settings; write tools always require approval; forbidden tools cannot be enabled.
- Tests: valid checked-in defaults parse; unknown keys, duplicate server IDs, HTTP URLs, permissive
   defaults, enabled forbidden tools, and unapproved writes fail.
- Completion: V0 for both schema test files, then V1.

#### A1.1 - Verify production MCP topology and capability binding

- Status: `BLOCKED - CLIENT ALLOWLIST`
- Dependencies: A1 and production environment access
- Verified endpoint: `https://microsoftsales.crm.dynamics.com/api/mcp`, matching Microsoft's
   environment-scoped Dataverse MCP URL contract.
- Verified probe: protocol initialization reached MSXPROD, but the environment returned HTTP 403
   because Azure CLI application `04b07795-8ddb-461a-bbee-02f9e1bf7b46` is not an allowed MCP client.
- Required evidence: initialize the endpoint with the production TLC client identity, capture
   `tools/list`, classify every advertised read tool as Dataverse broad or MSX curated, and validate
   each selected input schema against the adapter contract.
- Constraint: keep both checked-in server entries disabled and retain placeholder URLs until this
   evidence exists. Do not invent a separate MSX endpoint or enable policy entries from documentation
   alone.
- Local model: `COMPLETE`. An optional `connectionId` allows multiple logical server IDs to share one
   physical client, concurrency limit, health state, retry policy, and circuit breaker. Shared aliases
   must have identical endpoint, authentication, limit, retry, and breaker settings.
- Completion: V0 capability-binding tests from a sanitized discovery fixture, V1, and an operational
   `tools/list` probe using the allowlisted production client. Gate G1A then closes.

#### A2 - Add semantic mapping and guarded-query contracts

- Status: `COMPLETE`
- Dependencies: A1
- Files: `packages/common/configuration/dataverse-entity-map.ts`,
   `packages/common/contracts/mcp.ts`, `config/dataverse.entity-map.json`.
- Behavior: strict entity/attribute maps, mandatory `userScopePredicate` for non-reference entities,
   canonical names, sensitivity and prompt inclusion metadata, structured query operators, explicit
   projections, bounded filters/expands/order clauses, and a hard row ceiling.
- Tests: reject missing scope predicates, duplicate canonical/logical names, restricted prompt
   fields, empty/duplicate selects, unknown operators, oversized `top`, and unknown keys.
- Completion: V0, V1, and a secret-pattern scan of checked-in configuration.

#### A3 - Add scope, workflow, run, lineage, and change-set contracts

- Status: `COMPLETE`
- Dependencies: A2
- Files: `packages/common/contracts/workflows.ts`, existing contract exports, compatibility adapter.
- Behavior: scope hierarchy (`portfolio`, `account`, `opportunity`), workflow definition/run states,
   connector-call journal metadata, normalized MCP evidence lineage, queue/result card unions, and
   proposal/approval/result contracts. Legacy opportunity requests normalize without changing their
   accepted wire shape.
- Tests: strict parsing, scope ID requirements, legal state transitions, legacy normalization,
   result-card discrimination, and itemized write approval requirements.
- Completion: V0, V1, V2. Gate G0 closes when A1-A3 are complete.

### Phase B - Trusted MCP transport and policy broker

#### B1 - Implement the shared MCP transport package

- Status: `COMPLETE`
- Dependencies: A3
- Files: `packages/connectors/mcp/*`, workspace/package metadata.
- Behavior: SDK-backed Streamable HTTP client, injected delegated-token provider, initialize/list/call,
   cancellation, per-call timeout, normalized errors, bounded response bytes, and disposal. No token
   or raw response body appears in errors or logs.
- Tests: fixture server success, malformed response, timeout, abort, 401, 429 retry, byte cap, and
   redaction. Dependency audit must have no unresolved high/critical advisory introduced by this item.
- Completion: V0, V1, V2.

#### B2 - Implement client pool health, retries, and circuit breaker

- Status: `COMPLETE`
- Dependencies: B1
- Behavior: lazy warm session per enabled server, maximum concurrency, capped exponential retry,
   retry-after handling, health states, open/half-open/closed breaker, and deterministic disposal.
- Tests: fake timers cover transitions and retry exhaustion; concurrency never exceeds configuration;
   unauthorized calls do not retry as transient failures.
- Completion: V0, V1, V2.

#### B3 - Implement the default-deny Tool Broker

- Status: `COMPLETE`
- Dependencies: B2
- Files: `packages/orchestrator/policies/*`, `packages/orchestrator/routing/*`.
- Behavior: exact server/tool allowlist match, capability/scope enforcement, forbidden/destructive
   hard block, write approval block, rate and row limits, field redaction, untrusted-content wrapping,
   and metadata-only invocation journal.
- Tests: unknown tool denial, scope/capability mismatch, delete denial despite misleading annotations,
   write denial without approval, redaction, truncation, and journal content checks.
- Completion: V0, V1, V2. Gate G1 closes only after a focused security review of these invariants.

### Phase C - Read-only connector adapters and deterministic engine

#### C1 - Implement Dataverse MCP read adapter and fixture

- Status: `COMPLETE`
- Dependencies: B3
- Files: `packages/connectors/dataverse-mcp/*`.
- Behavior: semantic translation, mandatory user predicate injection, allowlisted projection/filter/order,
   row cap, provenance conversion, auth/partial states, and sample fixture parity.
- Tests: query-guard unit matrix, fixture contract tests, transport failure mapping, cancellation, and
   attempts to bypass scope through filters/expands.
- Completion: V0, V1, V2.

#### C2 - Implement MSX MCP read adapter and fixture

- Status: `COMPLETE`
- Dependencies: B3
- Files: `packages/connectors/msx-mcp/*`.
- Behavior: typed read methods for opportunity/account/pipeline/stakeholders/activities/forecast;
   source health and lineage; feature-flagged MCP path with direct Web API fallback; never duplicate a call.
- Tests: fixture contracts, fallback precedence, parity with direct read shapes, unauthorized/partial
   mapping, timeout and cancellation.
- Completion: V0, V1, V2.

#### C3 - Implement workflow registry and lifecycle

- Status: `COMPLETE`
- Dependencies: C1, C2
- Files: `packages/orchestrator/workflows/*`, `packages/orchestrator/progress/*`.
- Behavior: load and validate definitions, deterministic routing, queued/running/complete/partial/
   unauthorized/failed/cancelled lifecycle, cancellation, bounded local history, metadata journal,
   and first-result timing.
- Tests: invalid definition rejection, legal transitions, cancellation race, history eviction,
   partial required/optional connector behavior, and deterministic connector precedence.
- Completion: V0, V1, V2.

#### C4 - Implement the initial deterministic workflow cohort

- Status: `COMPLETE` (Gate G2 closed)
- Dependencies: C3
- Workflows: WF-001, WF-002, WF-005, WF-006, WF-009, WF-010.
- Behavior: each workflow has a versioned definition, guarded input, deterministic output card/queue
   shape, evidence lineage, source health, and no model dependency.
- Tests: golden fixtures, empty data, unauthorized source, partial optional enrichment, truncation,
   ordering/tie behavior, and SLA benchmark with deterministic clocks where possible.
- Completion: V0 per workflow, V1, V2. Gate G2 requires 100% fixture reliability and measured P50
   below six seconds in the representative integration harness.

### Phase D - Product surfaces and host parity

#### D1 - Expose workflow APIs through Electron and web trusted hosts

- Status: `COMPLETE`
- Dependencies: C4
- Behavior: list definitions, start/get/cancel run, and list bounded run history through validated IPC
   and HTTP envelopes. Electron owns one process-lifetime host; Web owns bounded, persistent,
   per-principal hosts and disposes MCP pools on eviction. Renderer never receives tokens, raw MCP
   errors, or unrestricted rows. Both release packages include the required MCP registry, policy,
   and Dataverse entity map.
- Tests: IPC and web route contract tests, malformed request rejection, cancellation, auth and partial
   states, desktop/web response parity, client envelope serialization, principal-cache disposal, and
   production asset packaging.
- Completion: V0, V1, V2.

#### D2 - Build Workflow Launcher and scope controls

- Status: `COMPLETE`
- Dependencies: D1
- Behavior: left-rail Workflows entry, persona/source/cadence/mode filters, visible scope hierarchy,
   one-click default runs, progressive parameters, stable responsive layout, and complete/partial/
   unauthorized states.
- Tests: component behavior plus Playwright desktop/mobile flows for discovery, scope switching, run,
   cancellation, partial, and unauthorized rendering. Existing account/opportunity journeys remain green.
- Completion: V0, V1, V4, then V5 for web parity.

#### D3 - Build Workflow Runs rail and typed result cards

- Status: `COMPLETE` (Gate G3 closed)
- Dependencies: D2
- Behavior: bounded recent runs, activity drawer with calls/counts/truncation/timing, metric strip,
   record table, timeline, action list, and queue cards; no nested cards or raw markdown-only workflow output.
- Tests: keyboard and screen-reader semantics, loading/error/empty states, responsive overflow, redaction,
   and screenshot checks at desktop and mobile viewports.
- Completion: V0, V1, V4, V5. Gate G3 closes when launcher and run surfaces pass regression E2E.

### Phase E - Composite and agent handoff

#### E1 - Implement staged Dataverse-to-MSX composition

- Status: `COMPLETE` (Gate G4 closed)
- Dependencies: D3
- Files: `packages/orchestrator/workflows/runtime.ts`,
   `packages/orchestrator/workflows/cohort-executor.ts`,
   `tests/fixtures/mcp/composite-workflows.ts`.
- Behavior: broad retrieval first, curated enrichment second, stable precedence and reconciliation,
   progressive first result, explicit missing-source blocks, and deterministic partial fallback on timeout.
- Tests: precedence conflicts, required/optional failures, timeout budget, lineage preservation,
   deduplication, cancellation between stages, and P50 core payload below ten seconds.
- Completion: V0, V1, V2. Gate G4 requires latency and reconciliation targets.

#### E2 - Implement WF-003, WF-007, and WF-012

- Status: `COMPLETE`
- Dependencies: E1
- Behavior: composite deterministic core plus one-click `Send to Guidance` using normalized,
   redacted workflow context and existing four capabilities only.
- Tests: golden fixtures, citation integrity, capability routing, prompt-size bounds, partial handoff,
   and existing agent response conformance.
- Completion: V0, V1, V2, V4, V5.

### Phase F - Governed writes (separate release decision)

#### F1 - Implement proposal and approval lifecycle with no live apply

- Status: `NOT STARTED`
- Dependencies: E2 and an explicit Gate G5 decision record
- Behavior: itemized field before/after, rationale, evidence, expiration, re-read conflict detection,
   explicit user approval, and immutable metadata audit. Live apply remains disabled.
- Tests: stale proposal, partial approval rejection, identity/scope mismatch, conflict, replay, tamper,
   expiration, and audit redaction.

#### F2 - Add live write adapters behind independent kill switches

- Status: `NOT STARTED`
- Dependencies: F1 and security approval recorded at Gate G5
- Behavior: approved change sets only, least-privilege tools, idempotency, per-item result, conflict-safe
   re-read, audit note, and immediate global disable. Delete and schema mutation remain impossible.
- Tests: sandbox integration plus all B3 policy tests; no production enablement in automated tests.
- Completion: full V0-V5, threat-model review, rollback drill, and separate release sign-off.

## 17) Release Gates

| Gate                     | Blocks              | Pass evidence                                                                              |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------ |
| G0 Contract baseline     | MCP runtime work    | A1-A3 complete; strict/config/compatibility tests green; schema versions documented        |
| G1 Security foundation   | Connector adapters  | default deny, destructive block, delegated scope, redaction, and journal tests green       |
| G1A Capability binding   | Live MCP enablement | allowlisted client; production `tools/list`; exact tool/schema bindings tested             |
| G2 Deterministic value   | Product UI          | six initial workflows reliable in fixtures; P50 < 6s; explicit partial/unauthorized states |
| G3 Experience regression | Composite work      | desktop and web launcher/run E2E green; existing core journeys green                       |
| G4 Composite quality     | Agent handoff       | precedence, lineage, cancellation, partial fallback green; P50 core < 10s                  |
| G5 Write authorization   | Any live write code | separate decision record, threat model, approval UX, conflict tests, rollback drill        |
| G6 Release               | Flag enablement     | V1-V5 green, no high/critical new dependency findings, operational runbook complete        |

No gate is waived because a live dependency is unavailable. Fixture and contract evidence remains
mandatory; unavailable live checks are recorded as deferred operational validation.

## 18) Execution Evidence Log

| Date       | Item    | Validation                                                                                                                                                                                                                                                                      | Result | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | A0      | Document review against source plans and repository layout                                                                                                                                                                                                                      | PASS   | Defaults locked and implementation ledger established on `mcp` branch                                                                                                                                                                                                                                                                                                                 |
| 2026-09-12 | A1      | `mcp-configuration.test.ts` (9 tests); `npm run typecheck`                                                                                                                                                                                                                      | PASS   | Disabled defaults, strict registry, default deny, write approval, and destructive blocks validated                                                                                                                                                                                                                                                                                    |
| 2026-09-12 | A2      | `dataverse-contracts.test.ts` (12 tests); `npm run typecheck`; config secret-pattern scan                                                                                                                                                                                       | PASS   | Scope predicates, mapping uniqueness, restricted fields, projections, operators, and row caps validated                                                                                                                                                                                                                                                                               |
| 2026-09-12 | A3 / G0 | `workflow-contract.test.ts` (12 tests); `npm run typecheck`; regression suite excluding unrelated manifest baseline (165 tests)                                                                                                                                                 | PASS   | Workflow contract version `1.0`, strict scopes, lifecycle transitions, result cards, change-set approvals, and legacy normalization validated. Full suite also passed 165 tests but retained one pre-existing CRLF-only mismatch in `foundry-agent-manifests.test.ts`. G0 closed.                                                                                                     |
| 2026-09-12 | B1      | MCP transport unit/integration (8 tests); `npm run typecheck`; `npm test` (174 tests); `npm run lint`; `npm audit --omit=dev --audit-level=high`                                                                                                                                | PASS   | SDK-backed Streamable HTTP initialize/list/call, delegated token injection, cancellation, timeout, one 429 retry, response byte cap, safe error normalization, disposal, and Windows-stable manifest regression validated; zero production vulnerabilities.                                                                                                                           |
| 2026-09-12 | B2      | MCP client pool unit tests (9 tests); `npm run typecheck`; `npm test` (184 tests); `npm run lint`; `npm audit --omit=dev --audit-level=high`                                                                                                                                    | PASS   | Lazy initialization, bounded concurrency, capped retry and Retry-After handling, retry exhaustion, transient-only breaker accounting, open/half-open/closed transitions, queued-call rejection, and deterministic disposal validated; zero production vulnerabilities.                                                                                                                |
| 2026-09-12 | B3 / G1 | Tool authorization and broker unit tests (12 tests); `npm run typecheck`; `npm test` (196 tests); `npm run lint`; `npm audit --omit=dev --audit-level=high`                                                                                                                     | PASS   | Exact default-deny allowlisting, enabled-server/capability/scope checks, destructive and unapproved-write blocks before transport, request/rate/row limits, recursive redaction, untrusted wrapping, and bounded metadata-only journaling validated; zero production vulnerabilities. G1 closed.                                                                                      |
| 2026-09-12 | C1      | Dataverse query guard and adapter tests (15 tests); `npm run typecheck`; `npm test` (211 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm audit --omit=dev --audit-level=high`                                                                      | PASS   | Semantic mapping, mandatory delegated scope injection, projection/filter/order allowlists, row caps, scope and expansion bypass rejection, canonical result filtering, lineage, auth/partial/failure mapping, cancellation, and deterministic fixture parity validated; zero production vulnerabilities.                                                                              |
| 2026-09-12 | C2      | MSX MCP adapter and configuration tests (16 tests); `npm run typecheck`; `npm test` (218 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm audit --omit=dev`                                                                                         | PASS   | Six strict read contracts, exact broker invocation, deterministic fixture parity, disabled policy defaults, source health and lineage, unauthorized/timeout/truncation mapping, cancellation, malformed-response rejection, and mutually exclusive MCP/direct routing validated; zero production vulnerabilities.                                                                     |
| 2026-09-12 | C3      | Workflow registry, history, and runtime tests (13 tests); `npm run typecheck`; `npm test` (231 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm audit --omit=dev`                                                                                   | PASS   | Atomic registry loading, deterministic connector order, legal lifecycle transitions, required/optional outcomes, unauthorized state, queued/running cancellation race protection, SLA timeout, bounded metadata-only history/results, and first-result timing validated on `mcp`; zero production vulnerabilities.                                                                    |
| 2026-09-12 | C4 / G2 | Initial workflow cohort, runtime, and Dataverse contract tests (34 tests); `npm run typecheck`; `npm test` (247 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm audit --omit=dev`                                                                  | PASS   | All six deterministic workflows passed golden, empty, malformed-input, optional unauthorized, required truncation, stable tie-ordering, strict card/queue/lineage/source-health, and representative P50 fixture checks through shared host-neutral code on `mcp`; zero production vulnerabilities. G2 closed.                                                                         |
| 2026-09-12 | D1      | Host parity, runtime, cache, renderer-client, and release-package focused tests (24 tests); `npm run typecheck`; `npm test` (256 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm audit --omit=dev`; `npm run desktop:build`; `npm run web:package` | PASS   | Five lifecycle operations use one validated dispatcher across Electron IPC and authenticated Web HTTP; partial, unauthorized, malformed, cancellation, history, raw-row non-disclosure, per-principal host disposal, renderer envelopes, external MCP SDK dependency, and packaged MCP configuration passed on `mcp`; zero production vulnerabilities.                                |
| 2026-09-12 | D2      | Workflow Launcher and Electron Playwright flows; V1-V5; `npm run test:smoke:revamp` (11 tests); `npm test` (256 tests); production dependency audit                                                                                                                             | PASS   | Shared Desktop/Web launcher passed discovery, persona/source/cadence/mode filters, scope switching, progressive parameters, default execution, cancellation, complete/partial/unauthorized rendering, mobile overflow, IPC parity, and existing account/opportunity regressions on `mcp`; zero production vulnerabilities. G3 remains open pending D3.                                |
| 2026-09-12 | D3 / G3 | Workflow Runs and typed-result Playwright flows; V0-V5; revamp E2E (17 tests); Vitest (256 tests)                                                                                                                                                                               | PASS   | Shared Desktop/Web recent-run rail, bounded history, keyboard selection, all five typed result discriminants, operational queue, metadata-only activity drawer, loading/error/empty states, truncation, mobile overflow, deterministic desktop/mobile screenshots, Electron IPC parity, and existing journeys passed on `mcp`; zero production vulnerabilities. G3 closed.            |
| 2026-09-12 | E1 / G4 | Composite runtime, cohort, and contract focused tests (28 tests); `npm run typecheck`; `npm test` (261 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm run test:smoke:revamp` (17 tests)                                                           | PASS   | Reusable Dataverse and MSX samples passed through both fixture brokers and adapters; staged progressive publication, curated-field precedence, deduplication, stable cohort membership, lineage, missing-source health, timeout fallback, cancellation, and representative latency targets passed in shared host-neutral code on `mcp`. Desktop/Web parity remained green. G4 closed. |
| 2026-09-12 | E2      | Guidance routing, host, and contract focused tests (19 tests); `npm run typecheck`; `npm test` (269 tests); `npm run lint`; `npm run check:structure`; `npm run preflight`; `npm run test:smoke:revamp` (18 tests); `npm audit --omit=dev --audit-level=high`                   | PASS   | WF-003, WF-007, and WF-012 passed representative composite fixtures and strict normalized guidance handoffs. Existing capability routing, prompt and fact bounds, partial-result support, evidence-lineage rejection, raw-row non-disclosure, shared Electron/Web transports, and the shared `Send to Guidance` journey passed on `mcp`; zero production vulnerabilities.             |

### A1.1 blocked operational evidence

On 2026-09-12, documentation review confirmed the environment endpoint and extensible tool model.
A read-only initialize and `tools/list` probe reached MSXPROD, but it rejected Azure CLI client
`04b07795-8ddb-461a-bbee-02f9e1bf7b46` with HTTP 403 before discovery because the client is not
allowlisted. No data tool was called. Physical topology and exact tool bindings remain unverified,
so live configuration remains disabled.

The local connection-alias model passed 20 focused configuration and pool tests, all 282 Vitest tests,
repository typecheck, and lint. Tests verify one initialized/disposed client across `dataverse` and
`msx` logical IDs and reject aliases with conflicting physical connection settings.

## 19) Rollback and Failure Rules

1. Each MCP server and the Workflow Launcher have independent flags, default off.
2. A connector failure opens only that connector's breaker; existing direct MSX reads remain available.
3. Schema migration is additive during the compatibility window; legacy request parsing is removed
    only in a separately versioned release.
4. Local run history is bounded and disposable. It is never required to restore source-of-truth data.
5. Any scope-bypass, token exposure, forbidden-tool invocation, or unapproved write fails closed and
    blocks the phase regardless of other test results.
6. Rollback disables the affected flag and preserves metadata-only diagnostics; it does not replay calls.

## 20) Initial Test Matrix

| Surface               | Unit     | Contract | Integration               | E2E                      | Security                                |
| --------------------- | -------- | -------- | ------------------------- | ------------------------ | --------------------------------------- |
| Configuration schemas | required | required | n/a                       | n/a                      | secret scan, strict rejection           |
| Query guard           | required | required | fixture MCP               | n/a                      | scope bypass, allowlist, caps           |
| MCP transport/pool    | required | required | fixture HTTP server       | n/a                      | token/error redaction, byte cap         |
| Tool Broker           | required | required | fixture connectors        | n/a                      | default deny, writes, destructive tools |
| Workflow engine       | required | required | six workflow fixtures     | launcher flow            | cancellation, journal redaction         |
| Host APIs             | required | required | Electron IPC and web HTTP | launcher flow            | malformed/auth boundaries               |
| Composite engine      | required | required | dual fixture connectors   | partial/progressive flow | precedence and restricted fields        |
| Governed writes       | required | required | sandbox only              | approval/conflict flow   | replay, tamper, identity, rollback      |
