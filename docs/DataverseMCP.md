# Dataverse + MSX MCP Expansion Plan

Status: Planning only (no implementation)
Date: 2026-09-12
Owner: TBD
Scope: Desktop revamp first, web parity second

## 1) Objectives

This plan defines how to add two MCP-backed connector planes while keeping a clear domain split:

- Dataverse MCP: broad, cross-entity business workflows and operational asks.
- MSX MCP: seller-focused, narrow, high-signal workflows optimized for daily execution.

This plan also evaluates whether the current four-agent model is enough, proposes optional additional agents, and defines UI surfaces to expose workflows in a crisp, fluid way.

## 2) Current Baseline (as of this plan)

- Four agents:
  - Account Pulse
  - MCEM Coach
  - Pursuit and Executive
  - Risk and Solution Play
- Current contracts are strong for:
  - account/opportunity/milestone read paths
  - stage coaching
  - markdown response rendering
  - source health and citation expectations
- Current UI has:
  - blades (Accounts, Opportunities, Workbench, Next-best-actions)
  - tabbed center workbench (MSX, Guidance, Stages)
  - capability picker for existing agents
- Current connector reality:
  - live desktop path is MSX-centric
  - role-aware guidance exists, role-aware portfolio retrieval is limited

## 3) Why Add Dataverse MCP if MSX Exists?

MSX data is essential but intentionally constrained around opportunity execution. Dataverse MCP can unlock broader account-operating workflows that require relationship, activity, milestone hygiene, coordination, and process orchestration across more entities.

Expected net effect:

- Better breadth for asks like "what is stale across my portfolio", "show blocked milestones by owner", "find accounts with missing stakeholder coverage", "prepare weekly governance exceptions".
- Better decomposition: Dataverse handles broad graph-style operational retrieval, MSX MCP handles seller-critical path details and write-safe funnels.
- Better agent quality: richer context assembly before agent invocation.

## 4) Target Connector Architecture

## 4.1 Domain Split

Dataverse MCP responsibilities:

- Broad retrieval and joins across entities related to account execution.
- Operational portfolio analytics and exception detection.
- Workflow precomputation (signals, gaps, hygiene checks, ownership heatmaps).
- Generic query mediation for safe natural-language asks via constrained templates.

MSX MCP responsibilities:

- Narrow, seller-focused retrieval and updates where allowed by product policy.
- Opportunity, milestone, stage-related flows with strict semantics.
- High-confidence actions requiring business-rule enforcement.

Shared orchestrator responsibilities:

- Intent routing to Dataverse MCP, MSX MCP, or both.
- Plan/execution decomposition for composite asks.
- Result stitching into a single response contract with source attribution.

## 4.2 Request Lifecycle

1. User triggers ask (prompt, workflow card, quick action).
2. Orchestrator classifies intent into one of:
   - Dataverse-only
   - MSX-only
   - Composite
3. Orchestrator generates a query plan with cost budget and authorization context.
4. Connector adapters execute calls via MCP.
5. Normalizer emits common envelope.
6. Agent layer consumes normalized data if reasoning/synthesis is needed.
7. UI renders either a direct answer for deterministic workflows or an agent response with citation and action package.

## 4.3 Failure Behavior

- Partial data must still return actionable output with "state=partial" and explicit missing source blocks.
- Unauthorized data must never be silently suppressed.
- Every workflow response contains:
  - source set
  - freshness
  - authorization state
  - fallback behavior used

## 5) Agent Strategy: Keep 4 or Add More?

## 5.1 Recommendation

Keep the current four as the executive synthesis layer, and add two optional specialist agents for workflow execution scale:

- Workflow Orchestrator Agent (new)
- Portfolio Operations Agent (new)

Reasoning:

- The existing four are strong for narrative synthesis and recommendation quality.
- Dataverse MCP introduces many deterministic operational asks that do not always need the same heavy narrative agent path.
- Two specialist agents reduce overload and improve latency by routing deterministic tasks away from long-form agents.

## 5.2 Proposed Agent Roles

Workflow Orchestrator Agent (new)

- Converts broad natural-language asks into workflow execution plans.
- Chooses deterministic workflow templates before falling back to generative synthesis.
- Returns compact run cards (inputs, outputs, confidence, next action).

Portfolio Operations Agent (new)

- Handles hygiene/exception/governance workflows:
  - stale opportunities
  - missing owners
  - overdue milestones
  - commitment-risk mismatches
  - role assignment drift
- Returns operational queues and bulk-action recommendations (human-reviewed).

Existing four remain unchanged but gain richer context from Dataverse + MSX MCP.

## 5.3 Minimum Viable Agent Expansion Option

If you want lower complexity first:

- Do not add new LLM agents yet.
- Add a deterministic workflow engine in orchestrator.
- Keep four existing agents for synthesis only.

This is lower risk and can be upgraded later to named specialist agents.

## 6) Workflow Expansion Catalog

## 6.1 Workflow Families Enabled by Dataverse MCP

1. Portfolio Hygiene
2. Stage Progression Quality
3. Ownership and Role Coverage
4. Risk and Blocker Operations
5. Meeting and Cadence Operations
6. Forecast Readiness
7. Account Relationship Intelligence
8. Activity and Follow-up Compliance
9. Cross-opportunity Dependency Tracking
10. Executive Review Packs

## 6.2 Detailed Workflow Matrix

| Workflow ID | Workflow Name                 | Primary Connector | Secondary Connector          | Deterministic or Agentic       | Primary Persona |
| ----------- | ----------------------------- | ----------------- | ---------------------------- | ------------------------------ | --------------- |
| WF-001      | Stale opportunity sweep       | Dataverse MCP     | MSX MCP                      | Deterministic                  | AE/Manager      |
| WF-002      | Overdue milestone triage      | Dataverse MCP     | MSX MCP                      | Deterministic                  | Specialist/SE   |
| WF-003      | Stage-evidence mismatch queue | Dataverse MCP     | MSX MCP                      | Agentic (MCEM Coach assist)    | Specialist/ATS  |
| WF-004      | Missing stakeholder map       | Dataverse MCP     | LinkedIn/SharePoint optional | Agentic                        | AE/ATS          |
| WF-005      | Weekly governance exceptions  | Dataverse MCP     | MSX MCP                      | Deterministic + summary        | Manager         |
| WF-006      | Commit-risk conflict list     | Dataverse MCP     | MSX MCP                      | Deterministic                  | Manager/CSAM    |
| WF-007      | Next-meeting prep pack        | Dataverse MCP     | MSX MCP + existing agents    | Agentic                        | AE/ATS          |
| WF-008      | Pipeline concentration risk   | Dataverse MCP     | MSX MCP                      | Deterministic + risk synthesis | Leadership      |
| WF-009      | Owner workload imbalance      | Dataverse MCP     | none                         | Deterministic                  | Manager         |
| WF-010      | Activity follow-up debt       | Dataverse MCP     | Graph optional               | Deterministic                  | Seller/SE       |
| WF-011      | Opportunity dependency graph  | Dataverse MCP     | none                         | Deterministic visualization    | Manager         |
| WF-012      | Stage exit evidence packet    | Dataverse MCP     | MSX MCP + MCEM               | Agentic                        | Specialist/SE   |

## 7) UI Surface Plan

Goal: expose workflows without cluttering the current blade model.

## 7.1 New Primary Surfaces

Surface A: Workflow Launcher (new, left nav item)

- A dedicated launcher page for high-value workflow cards.
- Supports filters:
  - Persona
  - Data source (Dataverse/MSX/Composite)
  - Cadence (daily/weekly/monthly)
  - Deterministic/Agentic

Surface B: Operational Queue (new, right rail tab)

- Focused queue of generated work items from workflows.
- Items support:
  - open context
  - send to guidance
  - export
  - defer
  - mark reviewed

Surface C: Workbench Workflow Panel (new panel under current tabs)

- Inside selected account/opportunity context, user can run contextual workflows.
- Shows input form, runtime state, and compact result card.

## 7.2 Keep Existing Surfaces but Enhance

- Existing "Guidance" tab remains synthesis hub.
- Existing "Next-best actions" becomes "Actions & Workflows" with two subviews:
  - Actions
  - Workflow Runs
- Existing search can include workflow shortcuts, not only entities.

## 7.3 Interaction Model

For crisp and fluid UX:

- One-click run for preconfigured workflows.
- Progressive disclosure for advanced filters.
- Non-blocking execution with progress toasts.
- Queue-first output for deterministic workflows.
- Workbench takeover only for deep agentic analysis.

## 7.4 Suggested Layout Wireframe (textual)

Top command bar:

- Search
- Context selector (Account / Opportunity / Global)
- Mode badge
- User identity

Left rail:

- Home
- Accounts
- Opportunities
- Workflows (new)
- Guidance

Center workbench tabs:

- MSX
- Guidance
- Stages
- Workflows (new)

Right rail:

- Actions
- Workflow Runs (new)
- Source Health

## 8) Internal Schema Plan

The system should not leak MCP-specific response variability into UI. Introduce normalized internal contracts.

## 8.1 Workflow Definition Schema

```json
{
  "$schema": "https://tlc.local/schemas/workflow-definition.v1.json",
  "id": "WF-005",
  "name": "Weekly governance exceptions",
  "version": "1.0.0",
  "scope": "portfolio",
  "personaTargets": ["Manager", "AE", "ATS"],
  "category": "governance",
  "executionMode": "deterministic",
  "defaultConnectorPlan": [
    { "connector": "dataverse-mcp", "operation": "query", "required": true },
    { "connector": "msx-mcp", "operation": "enrich", "required": false }
  ],
  "inputSchemaRef": "workflow-input-wf-005.v1",
  "outputSchemaRef": "workflow-output-wf-005.v1",
  "sla": { "targetMs": 4000, "timeoutMs": 12000 },
  "auth": { "requiresDelegatedUser": true, "allowedWrite": false },
  "ui": {
    "cardStyle": "exception-list",
    "resultPriority": "high",
    "showInQuickLaunch": true
  }
}
```

## 8.2 Workflow Run Schema

```json
{
  "$schema": "https://tlc.local/schemas/workflow-run.v1.json",
  "runId": "uuid",
  "workflowId": "WF-005",
  "startedAt": "2026-09-12T19:25:00Z",
  "completedAt": "2026-09-12T19:25:03Z",
  "status": "complete",
  "state": "partial",
  "context": {
    "accountId": "optional",
    "opportunityId": "optional",
    "persona": "Manager"
  },
  "connectorCalls": [
    {
      "connector": "dataverse-mcp",
      "operation": "query",
      "status": "success",
      "durationMs": 800,
      "recordCount": 128
    },
    {
      "connector": "msx-mcp",
      "operation": "enrich",
      "status": "unauthorized",
      "durationMs": 120,
      "recordCount": 0
    }
  ],
  "resultRef": "result-store-key",
  "telemetry": {
    "correlationId": "uuid",
    "costUnits": 12,
    "cacheHit": true
  }
}
```

## 8.3 Normalized Evidence Envelope v2

```json
{
  "id": "ev-123",
  "source": "dataverse",
  "sourceSubtype": "msp_milestone",
  "recordId": "guid",
  "title": "Milestone: Customer outcome validation",
  "url": "https://...",
  "retrievedAt": "2026-09-12T19:25:01Z",
  "modifiedAt": "2026-09-10T12:00:00Z",
  "accessContext": "delegated-user",
  "quality": "observed",
  "sensitivity": "internal",
  "freshness": {
    "ageHours": 55,
    "band": "stale"
  },
  "lineage": {
    "connector": "dataverse-mcp",
    "queryTemplateId": "QRY-MILESTONE-OVERDUE-V1"
  },
  "excerpt": "Target date is in the past and status is At Risk"
}
```

## 8.4 Query Template Schema (safe NL-to-query)

```json
{
  "$schema": "https://tlc.local/schemas/query-template.v1.json",
  "templateId": "QRY-MILESTONE-OVERDUE-V1",
  "connector": "dataverse-mcp",
  "entity": "msp_milestones",
  "description": "Find overdue active milestones for visible opportunities",
  "allowedFilters": [
    "ownerId",
    "targetDateBefore",
    "statusIn",
    "opportunityId",
    "accountId"
  ],
  "sort": ["targetDate asc"],
  "maxRows": 500,
  "security": {
    "rowLevelPolicy": "signed-in-user-scope",
    "denyCrossTenant": true
  },
  "version": "1.0.0"
}
```

## 9) UI Contracts for Workflow Surfaces

## 9.1 Workflow Card ViewModel

```json
{
  "workflowId": "WF-002",
  "title": "Overdue milestone triage",
  "subtitle": "11 overdue across 4 opportunities",
  "persona": ["SE", "Specialist"],
  "complexity": "low",
  "executionMode": "deterministic",
  "estimatedTimeSec": 3,
  "sourceTags": ["Dataverse", "MSX"],
  "cta": "Run",
  "lastRun": {
    "at": "2026-09-12T18:55:00Z",
    "status": "complete",
    "state": "partial"
  }
}
```

## 9.2 Queue Item ViewModel

```json
{
  "itemId": "queue-901",
  "kind": "workflow-output",
  "workflowId": "WF-002",
  "priority": "P1",
  "title": "Milestone overdue: Customer outcome validation",
  "owner": "Avery Johnson",
  "accountName": "Contoso Energy",
  "opportunityName": "Grid operations modernization",
  "dueDate": "2026-09-10",
  "actions": ["Open", "Send to Guidance", "Export", "Snooze"],
  "status": "new"
}
```

## 10) Expanded Capability Map by Persona

AE:

- Weekly focus queue
- exec prep workflow
- relationship and stakeholder gaps
- concentration risk and commit confidence

ATS:

- stage evidence mismatches
- technical blocker heatmap
- dependency and proof readiness

Specialist/SSP:

- milestone triage
- stage transition readiness packets
- pursuit plan seed generation

SE:

- technical validation gaps
- proof sequence checklist
- risk-to-mitigation task packages

Manager/Leader:

- governance exception dashboards
- owner load balancing
- portfolio health rollups and drill-downs

## 11) MCP Tooling Plan

## 11.1 Dataverse MCP Operation Families

- Entity list and scoped query
- Relationship traversal
- Aggregate/group operations
- Metadata/schema introspection
- Safe updates for future phase (disabled in MVP)

## 11.2 MSX MCP Operation Families

- Opportunity retrieval
- Milestone retrieval
- Stage/commitment read
- Strictly governed updates (if enabled later)

## 11.3 Connector Adapter Contract

Each MCP adapter returns:

- normalized data payload
- source health block
- auth state block
- lineage metadata
- retryability hint

## 12) Routing and Orchestration Rules

Rule set:

1. If ask is deterministic and templated, run workflow directly.
2. If ask needs synthesis over deterministic output, call minimal agent.
3. If ask is narrative-heavy with strategy trade-offs, call existing specialized agent.
4. If ask mixes broad ops + seller detail, perform Dataverse first then MSX enrichment.
5. If latency budget exceeded, return partial deterministic output and offer "Deep analysis" action.

## 13) Performance and UX Targets

- Workflow card click-to-first-result: < 2 seconds (P50) for cached deterministic workflows.
- Fresh deterministic run complete: < 6 seconds (P50).
- Agentic synthesis complete: < 18 seconds (P50).
- UI remains interactive during all runs.
- Every run is cancellable.

## 14) Security and Governance Plan

- Keep read-only posture for expanded workflows in initial phase.
- Respect signed-in delegated access in each connector.
- Surface authorization failures with entity-level clarity.
- Do not persist secrets or raw restricted bodies outside approved cache policy.
- Add audit events for:
  - workflow launched
  - connector query family
  - partial/unauthorized outcomes
  - export/email actions

## 15) Telemetry Plan

Per workflow run capture:

- workflowId, persona, context scope
- connector mix and duration
- result state (complete/partial/unauthorized)
- follow-on action rate (open/guidance/export/snooze)
- user feedback category

KPIs:

- workflow adoption rate
- median time-to-action
- guidance conversion rate
- stale queue reduction over time

## 16) Rollout Plan

Phase 0: Foundations

- Define normalized schemas and adapter interface.
- Add workflow registry (metadata only).
- Add UI shell placeholders for Workflow surfaces.

Phase 1: Deterministic Workflows

- Launch 6 high-value deterministic workflows (WF-001, 002, 005, 006, 009, 010).
- Add Operational Queue.
- Add workflow run history.

Phase 2: Composite + Agentic

- Enable Dataverse + MSX composite workflows (WF-003, 007, 012).
- Add Workflow Orchestrator Agent or deterministic equivalent.
- Add contextual "Send to Guidance" transitions.

Phase 3: Leadership and Portfolio Intelligence

- Add concentration and dependency visualizations (WF-008, 011).
- Add manager presets and dashboard entry points.

## 17) Risks and Mitigations

Risk: Connector overlap causes inconsistent answers.
Mitigation: strict domain split and precedence rules.

Risk: Too many workflows overwhelm users.
Mitigation: persona-based quick launch + progressive disclosure.

Risk: Latency spikes on composite queries.
Mitigation: staged execution, cache, partial return contract.

Risk: Users confuse deterministic outputs with recommendations.
Mitigation: explicit output labeling and action semantics.

### 17.1 Risk Matrix (Planning)

| Risk ID | Risk                                                               | Probability | Impact | Owner             | Trigger                                                                           | Contingency                                                                                       |
| ------- | ------------------------------------------------------------------ | ----------- | ------ | ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R-01    | Dataverse/MSX overlap yields conflicting facts                     | Medium      | High   | Architecture lead | Same entity field differs across connectors for same context                      | Apply connector precedence rules, expose lineage in UI, flag run `state=partial` until reconciled |
| R-02    | Workflow catalog grows too quickly and hurts discoverability       | High        | Medium | Product lead      | Launch set exceeds agreed quick-launch capacity; drop in workflow completion rate | Enforce persona-based default sets, move low-use workflows behind advanced filter                 |
| R-03    | Composite workflow latency exceeds user tolerance                  | Medium      | High   | Orchestrator lead | P50 composite latency exceeds target for two consecutive releases                 | Degrade to staged output, return deterministic core first, defer agentic synthesis                |
| R-04    | Users treat deterministic outputs as final recommendations         | Medium      | Medium | UX lead           | Increased feedback for wrong owner/wrong action due to interpretation drift       | Add stronger labels, require explicit "Send to Guidance" for strategy synthesis                   |
| R-05    | Unauthorized responses appear as empty data and mask access issues | Medium      | High   | Security lead     | Spike in low-result runs without explicit auth warnings                           | Force explicit unauthorized banners and connector-level auth status blocks                        |
| R-06    | Schema drift between workflow contracts and UI view models         | Medium      | High   | Platform lead     | Frontend parse errors or contract mismatch events increase after schema updates   | Version contracts, keep backward compatibility window, add schema contract tests                  |
| R-07    | Over-agentization inflates cost and runtime for deterministic asks | Medium      | Medium | AI lead           | Agent invocation ratio rises for workflows tagged deterministic                   | Add deterministic-first routing guardrail and budget caps per workflow run                        |

## 18) Open Decisions

1. Should Workflow Orchestrator be a true new agent now or a deterministic planner first?
2. Should Operational Queue be global only or also account-scoped by default?
3. Which writeback workflows, if any, are allowed in a post-MVP governed mode?
4. Should manager persona get a dedicated dashboard route in left nav at launch?
5. Should Workflow Runs persist per-user locally, remotely, or hybrid?

## 19) Suggested Initial Backlog (Planning Artifacts Only)

- BRD addendum for Dataverse + MSX split
- workflow registry spec
- normalized envelope v2 spec
- UI interaction spec for Workflow Launcher and Operational Queue
- routing policy spec
- telemetry event dictionary
- permissions and governance checklist

## 20) Summary Recommendation

- Add Dataverse MCP as broad operational data plane.
- Keep MSX MCP as seller-critical execution plane.
- Preserve the existing four agents for strategic synthesis.
- Add either:
  - deterministic workflow engine first, then specialist agents, or
  - two specialist agents immediately if capacity supports it.
- Introduce new Workflow Launcher + Operational Queue surfaces to expose capability clearly and fluidly.
- Implement schema-first normalization to prevent connector-specific coupling in UI and agents.
