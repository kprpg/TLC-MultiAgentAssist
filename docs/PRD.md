# TLC Account Team Intelligence Platform

## Product Requirements Document

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Status           | Draft for stakeholder review                              |
| Version          | 0.1                                                       |
| Date             | 2026-08-24                                                |
| Product owner    | TBD                                                       |
| Target milestone | October TLC demonstration, exact date TBD                 |
| Primary source   | `TLC_Account_Team_Intelligence_Platform_Build_Guide.docx` |

## 1. Executive Summary

The TLC Account Team Intelligence Platform is a role-aware, multi-agent assistant for Microsoft account teams. It combines live opportunity data and approved internal knowledge to tell account team members what matters, why it matters, and what they should do next.

The first release should be a Windows thin client based on the proven MSX Helper Electron, React, and Fluent UI shell. This choice best satisfies the requirement to reuse the MSX Helper experience and authenticate with the signed-in user's Azure CLI context. The business and agent APIs must remain channel-neutral so a Teams app can be added later using Teams SSO and on-behalf-of authentication.

The product will expose one coherent experience backed by four specialized business agents:

1. Account Pulse Agent
2. MCEM Coach Agent
3. Pursuit and Executive Agent
4. Risk and Solution Play Agent

The agents will use MSX as the opportunity system of record, internal SharePoint and Seismic as approved content sources, LinkedIn as an optional external signal source, and the MCEM portal as the governing guidance source. All recommendations must identify their evidence, distinguish facts from inference, and require human review before any customer-facing use.

## 2. Background and Source Analysis

The governing build guide defines a Teams-first Copilot Studio demonstration with an orchestrator and the following capabilities: weekly brief, MCEM coaching, executive briefing, pursuit planning, account risk, and solution play assembly. It emphasizes consistent responses, role-aware actions, source labels, human review, weekly evaluation, and Git as the source of truth.

The current product direction changes several assumptions in that guide:

| Build guide baseline                                       | Current product direction                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Copilot Studio is the primary runtime.                     | Custom Teams app or thin client.                            |
| Teams is the primary surface.                              | Reuse the earlier Copilot or MSX Helper interface.          |
| Sample or permitted data is sufficient for the demo.       | Connect to MSX, SharePoint, Seismic, and LinkedIn.          |
| LinkedIn is out of scope for October.                      | LinkedIn is in the desired integration scope.               |
| Platform authentication is managed by Copilot Studio/M365. | Reuse the logged-in user's Azure CLI token where supported. |

This PRD treats the newer direction as authoritative while preserving the guide's business capabilities, response contract, trust model, and evaluation criteria.

## 3. Product Goal

Enable an account team member to open one application, select an account or opportunity, and receive grounded, role-specific guidance across weekly prioritization, MCEM progression, pursuit planning, executive preparation, risk management, and solution play assembly.

## 4. User Problem

Account team intelligence is fragmented across MSX records, internal documents, sales assets, external signals, and process guidance. Users spend time collecting information and reconciling it manually before they can decide what to do. Existing summaries often describe the account but do not translate evidence into MCEM-aware actions with owners, priorities, and sources.

## 5. Target Users and Personas

| Persona                             | Primary need                                          | Expected product value                                       |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| Account Executive (AE)              | Priorities, executive relationships, deal progression | Weekly focus, executive brief, customer ask, owner alignment |
| Account Technology Strategist (ATS) | Technology strategy and account alignment             | Technical signals, stakeholder gaps, solution alignment      |
| Specialist / SSP                    | Opportunity qualification and pursuit execution       | MCEM gaps, pursuit plan, proof and asset recommendations     |
| Solution Engineer (SE)              | Technical proof and customer engagement               | Validation gaps, demo plan, objections, follow-up actions    |
| CSA / CSAM                          | Delivery, adoption, and governance continuity         | Risks, dependencies, ownership, transition context           |
| Sales or account leader             | Portfolio visibility and intervention                 | Explainable priorities, confidence, risk, and accountability |

The interface must adapt recommendations and suggested ownership to the user's role while showing the same underlying evidence.

## 6. Product Principles

1. One experience, specialized agents. Users should not need to understand orchestration details.
2. Actions over summaries. Every substantive answer should identify a next action, owner role, and rationale.
3. Evidence before confidence. Unsupported claims must be omitted or marked as assumptions.
4. User permissions are the boundary. The product must not broaden access beyond the signed-in user's source permissions.
5. Human review is mandatory. The MVP drafts and recommends; it does not write to MSX or contact customers.
6. Graceful degradation. One unavailable source must not make all capabilities unusable.
7. Contracts over coupling. Agent and connector handoffs use versioned structured contracts.

## 7. Product Surface Decision

### Recommended MVP: Windows Electron Thin Client

Reuse the MSX Helper application shell and its established security pattern:

- React and Fluent UI for the renderer.
- Electron main process for authentication and connector calls.
- Context isolation, sandboxing, strict IPC, CSP, and domain allowlists.
- Access tokens retained in memory in the main process and never exposed to the renderer.
- MSX Helper navigation, loading, error, settings, account selection, and dense operational layout patterns.

### Alternatives Considered

| Option               | Advantages                                                                    | Constraints                                                                              | Recommendation     |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| Electron thin client | Direct UI reuse; local Azure CLI access; secure token isolation; fastest path | Windows-specific; installation required                                                  | MVP                |
| Teams app            | Native collaboration and distribution                                         | Browser cannot directly use local Azure CLI; requires Teams SSO/OBO and app registration | Phase 2 channel    |
| Dual-channel launch  | Broad reach from day one                                                      | Highest delivery, auth, testing, and operational complexity                              | Do not use for MVP |

The Teams option is not compatible with the literal Azure CLI token requirement. A Teams implementation must use Teams SSO and an on-behalf-of flow while preserving the same downstream authorization semantics.

## 8. Experience Requirements

### 8.1 Application Shell

The application must provide:

- Signed-in user and token status.
- Account and opportunity selector backed by MSX.
- Persona or role context, auto-detected when possible and user-selectable for preview.
- Home view with weekly focus, recent signals, open risks, and recommended actions.
- Four agent entry points presented as task-oriented tabs or navigation items.
- Conversation or guided task pane with cited responses.
- Three or four domain-relevant starter prompts for each agent, presented as keyboard-accessible choices that run immediately when selected while retaining a freeform prompt field.
- Agent responses rendered as safe, readable Markdown, including headings, lists, links, tables, quotes, and code, rather than displaying Markdown source syntax.
- VS Code-style toolbar controls that independently collapse and restore the working-context and next-best-actions panes while expanding the central workbench.
- Completed agent responses provide adjacent `Send E-mail` and `Export` actions. `Send E-mail` opens a recipient-addressed message in the user's Outlook client for human review and user-initiated sending; `Export` saves a formatted Word document.
- Source health and freshness indicators.
- Feedback controls: useful, inaccurate, missing source, wrong owner, not actionable.

### 8.2 Shared Response Contract

Every agent response must contain:

1. Summary
2. Context used, including account, opportunity, role, and MCEM stage
3. Observed signals with source and freshness
4. Risks, when relevant, with severity and rationale
5. Recommended actions with owner role, priority, and rationale
6. Sources or deep links the user is authorized to open
7. Assumptions and missing information
8. Optional customer-ready draft clearly labeled for human review
9. Feedback prompt

### 8.3 Key User Journeys

#### Weekly Account Focus

The user selects an account and asks what to focus on this week. The platform combines opportunity state, milestones, recent signals, risks, and approved content into a prioritized action list.

#### MCEM Progression

The user selects an opportunity and asks how to move it forward. The platform compares MSX evidence with versioned MCEM guidance, identifies missing exit criteria or stakeholder coverage, and recommends next actions and owners.

#### Executive Meeting Preparation

The user requests a brief for an upcoming meeting. The platform produces customer situation, opportunity context, commitments, risks, talking points, suggested ask, and internal-only guidance.

#### Pursuit Planning

The user requests a 30/60 day plan. The platform turns MCEM gaps into stakeholder actions, workshops, proof points, demo steps, milestones, owners, and a next-meeting agenda.

#### Risk Review and Solution Play

The user requests blockers or a solution package. The platform identifies supported risks and mitigation actions, then recommends approved SharePoint and Seismic assets, a demo path, objections, proof points, and a review-required follow-up draft.

## 9. Agent Requirements

### 9.1 Account Pulse Agent

Purpose: prioritize account and opportunity attention.

Responsibilities:

- Normalize permitted MSX and external signals.
- Rank opportunities, milestones, and actions using explainable criteria.
- Generate weekly focus and top-risk views.
- Explain every priority score or ranking decision.
- Avoid ranking when evidence is below a configurable threshold.

### 9.2 MCEM Coach Agent

Purpose: provide stage-aware Microsoft Customer Engagement Methodology guidance.

Responsibilities:

- Treat the current MSX stage and milestone state as observed system data, not automatically as proof that exit criteria are met.
- Retrieve the applicable, versioned MCEM guidance from the approved internal source.
- Evaluate evidence for stakeholder coverage, customer outcomes, technical validation, business case, next step, and other stage-specific criteria.
- Identify recorded-stage versus evidence-based-stage divergence.
- Recommend actions, owner roles, rationale, and missing information.
- Deep-link to the relevant MCEM guidance when the user has access.
- Never infer stage completion solely from a stage label.

### 9.3 Pursuit and Executive Agent

Purpose: convert account intelligence and MCEM gaps into meeting and pursuit readiness.

Responsibilities:

- Produce concise executive briefs.
- Produce 30/60 day pursuit plans.
- Separate sourced facts, internal strategy, and customer-ready draft text.
- Consume MCEM Coach outputs through a structured handoff.
- Include stakeholder strategy, workshops, demo plan, proof points, milestones, owner roles, and next meeting agenda.

### 9.4 Risk and Solution Play Agent

Purpose: identify execution risk and assemble an approved engagement package.

Responsibilities:

- Identify evidence-supported risks, severity, impact, mitigation, and owner roles.
- Search and rank approved SharePoint and Seismic assets.
- Produce a customer narrative, asset list, demo path, objections, proof points, and review-required follow-up draft.
- Flag unsupported claims, missing sources, stale assets, and external-facing content without review labels.
- Continue with partial results when one content source is unavailable.

## 10. Orchestration Requirements

- A single orchestrator must resolve account, opportunity, persona, intent, and required sources.
- The orchestrator must invoke the smallest set of agents required for the task.
- Agent calls must use versioned request and response contracts.
- The UI must show which sources and agents contributed without exposing hidden reasoning.
- Long-running tasks must report progress and allow cancellation.
- Partial failures must identify unavailable sources and preserve supported results.
- The orchestrator must not permit an agent to perform an external write in the MVP.

## 11. Data Source and Connector Requirements

| Source              | MVP use                                                         | Authentication expectation                                            | Product constraint                                                             |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| MSX / Dynamics 365  | Accounts, opportunities, milestones, team, activity, MCEM stage | Azure CLI token scoped to the MSX resource                            | Read-only; user-permitted records only                                         |
| Internal SharePoint | MCEM guidance and approved internal knowledge                   | Azure CLI token scoped to Microsoft Graph or SharePoint               | Preserve source ACLs and deep links                                            |
| MCEM Portal         | Governing methodology content                                   | SharePoint/Graph delegated access                                     | Ingest version and effective date; do not rely on hard-coded stage rules alone |
| Seismic             | Approved sales and solution assets                              | Seismic-supported delegated OAuth or approved service credential, TBD | Azure CLI token cannot be assumed to work                                      |
| LinkedIn            | Persona, company, role-change, and public signal enrichment     | Approved LinkedIn API and licensed access, TBD                        | No scraping or browser automation; disable when API approval is unavailable    |

All connectors must return a common evidence envelope containing source, source record ID, title, URL when available, retrieved time, source modified time when available, access context, and confidence or quality flags.

## 12. Authentication and Authorization

### 12.1 MVP Thin Client

- The application must detect Azure CLI availability and signed-in status.
- The Electron main process must request separate access tokens for each Microsoft resource audience.
- Tokens must be stored in memory only, refreshed before expiry, never logged, and never passed to the renderer.
- Connector requests must execute in the trusted main process or a local trusted service.
- The renderer communicates through a minimal validated IPC contract.
- The app must show actionable states for CLI missing, login required, tenant mismatch, consent required, expired token, and forbidden resource.
- Source authorization failures must not be presented as empty business data.

### 12.2 Non-Microsoft Sources

Azure CLI authentication does not automatically authorize Seismic or LinkedIn. Those connectors require their officially supported OAuth or service credential model and separate security approval.

### 12.3 Future Teams Channel

The Teams channel must use Teams SSO, token exchange, and on-behalf-of access to downstream resources. It must not attempt to read a local Azure CLI session.

## 13. Trust, Privacy, and Governance

- Enforce least privilege and the signed-in user's source permissions.
- Do not persist access tokens, raw restricted documents, or unnecessary personal data.
- Log source IDs, agent versions, outcome metadata, and errors without logging secrets or sensitive document bodies.
- Display citation, freshness, and assumption status with every recommendation.
- Label LinkedIn-derived signals distinctly from internal evidence.
- Require human review for customer-facing drafts.
- Provide a sample-data mode that is visibly distinct from live mode.
- Support deletion and retention rules for locally cached derived data.
- Do not use source content for model training unless separately approved.

## 14. Functional Requirements

| ID    | Requirement                                                                                      | Priority                         |
| ----- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| FR-01 | Authenticate the local user through Azure CLI for supported Microsoft resources.                 | Must                             |
| FR-02 | Select an authorized MSX account and opportunity.                                                | Must                             |
| FR-03 | Route requests through one orchestrated experience to four agents.                               | Must                             |
| FR-04 | Provide MCEM guidance grounded in MSX evidence and approved MCEM content.                        | Must                             |
| FR-05 | Generate weekly focus, executive brief, pursuit plan, risk review, and solution play outputs.    | Must                             |
| FR-06 | Cite sources, timestamps, assumptions, and missing data.                                         | Must                             |
| FR-07 | Search approved SharePoint and Seismic content.                                                  | Must, subject to access approval |
| FR-08 | Enrich with approved LinkedIn signals.                                                           | Should, subject to API approval  |
| FR-09 | Capture structured user feedback.                                                                | Must                             |
| FR-10 | Provide sample-data mode and graceful connector degradation.                                     | Must                             |
| FR-11 | Deep-link users to authorized source records and assets.                                         | Should                           |
| FR-12 | Publish the same business capabilities through Teams.                                            | Later                            |
| FR-13 | Present three or four relevant, selectable starter prompts for each of the four agents.          | Must                             |
| FR-14 | Render agent response Markdown as accessible, sanitized rich content in the desktop client.      | Must                             |
| FR-15 | Independently collapse, restore, and persist the left context and right action pane states.      | Must                             |
| FR-16 | Open a recipient-addressed message from a completed agent response in the user's Outlook client. | Must                             |
| FR-17 | Export a completed agent response as a formatted Microsoft Word `.docx` file.                    | Must                             |

## 15. Non-Functional Requirements

| Area            | Requirement                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security        | No token exposure to renderer; strict IPC validation; CSP and navigation allowlists; secrets never logged.                                                        |
| Performance     | Cached account context loads in under 2 seconds; initial live context target under 5 seconds; agent response target under 15 seconds excluding source throttling. |
| Reliability     | A noncritical connector failure returns a clearly marked partial response; critical MSX failures stop opportunity-specific analysis.                              |
| Accessibility   | Keyboard navigable and aligned to Fluent UI accessibility behavior; target WCAG 2.1 AA.                                                                           |
| Explainability  | Every recommendation has evidence, rationale, owner, and confidence or missing-data marker.                                                                       |
| Observability   | Correlation ID across UI, orchestrator, agents, and connectors; latency, failure, grounding, and feedback metrics.                                                |
| Maintainability | Versioned connector and agent contracts; prompts, policies, tests, and schemas stored in Git.                                                                     |
| Testability     | Deterministic fixtures for connectors; golden prompts and rubric-based evaluation for agent outputs.                                                              |

## 16. Success Metrics

### Demo Exit Metrics

- All six golden journeys complete through one interface.
- At least 90% of golden responses contain valid source labels and owner-specific actions.
- Zero unsupported account facts in the approved demo suite.
- All four agent owners can explain inputs, output, limitations, and user value.
- A disabled connector produces an explicit partial-data result rather than a fabricated or silent answer.

### Pilot Metrics

- At least 70% of responses rated useful by pilot users.
- At least 60% of recommended actions accepted, adapted, or saved.
- Median time to prepare an executive brief reduced by at least 50% from user baseline.
- Fewer than 5% of evaluated responses flagged as missing a required source.
- Fewer than 5% of evaluated responses flagged with the wrong owner role.

## 17. MVP Scope

### In Scope

- Electron thin client using MSX Helper visual and security patterns.
- Read-only MSX integration using Azure CLI token acquisition.
- Internal SharePoint and MCEM guidance retrieval.
- Four agents and one orchestrated experience.
- Shared response contract, citations, freshness, and feedback.
- Seismic connector behind a feature flag once credentials and API access are approved.
- LinkedIn connector interface and disabled state; live enrichment only if approved API access exists.
- Sample-data fallback and golden test suite.

### Out of Scope

- Autonomous customer communication.
- Production MSX writeback.
- LinkedIn scraping or use outside approved API terms.
- Broad ingestion of all internal SharePoint content.
- Simultaneous production launch of Electron and Teams clients.
- Unbounded autonomous planning or cross-account actions.
- Training models on internal or external source content.

## 18. Delivery Phases

### Phase 0: Access and Decision Gates

- Confirm product owner and October milestone.
- Approve Electron as MVP channel.
- Confirm reuse permission and technical boundary with MSX Helper.
- Validate Azure CLI token audiences and tenant access for MSX and SharePoint.
- Confirm Seismic and LinkedIn API entitlement and authentication options.
- Approve the canonical MCEM content path and content owner.

### Phase 1: Thin Slice

- Secure shell, auth status, account/opportunity selection.
- MSX and MCEM connector fixtures plus live read path.
- MCEM Coach end-to-end with citations and feedback.
- Shared contracts, telemetry, and sample mode.

### Phase 2: Four-Agent MVP

- Add Account Pulse, Pursuit and Executive, and Risk and Solution Play agents.
- Add SharePoint search and approved Seismic integration.
- Complete six golden journeys and failure-state tests.

### Phase 3: Demo Hardening

- Freeze demo data and agent versions.
- Complete security review, accessibility checks, evaluation scorecards, fallback evidence, and runbook.

### Phase 4: Teams Channel

- Add Teams UI adapter and Teams SSO/OBO gateway without changing business contracts.

## 19. Acceptance Criteria

The MVP is accepted when:

1. A user signed in to Azure CLI can launch the app and see their identity and source health without exposing a token to the renderer.
2. The user can select an MSX account and opportunity from records they are authorized to access.
3. "How do we move this opportunity to the next MCEM stage?" returns evidence-based gaps, owner roles, actions, rationale, MCEM source links, and missing-data labels.
4. The five other golden journeys return the shared response structure through the same interface.
5. Every factual claim in the golden suite maps to an evidence record or is labeled as an assumption.
6. The UI visibly distinguishes live, sample, stale, partial, and unauthorized data states.
7. Seismic or LinkedIn unavailability does not prevent MSX and MCEM workflows from completing.
8. No workflow writes to MSX or sends external communication.
9. Feedback is recorded with correlation ID, agent version, capability, and category.
10. Security tests confirm token isolation, IPC validation, navigation allowlists, and secret-safe logging.
11. Each agent displays three or four relevant starter prompts; selecting one submits that exact prompt and freeform entry remains available.
12. Agent Markdown responses render as structured content without executing embedded HTML or scripts.
13. Keyboard-accessible toolbar toggles independently collapse and restore both side panes, expose their state through accessible attributes, persist the preference, and allow the central workbench to consume the available width.
14. A completed agent response can open an addressed message through the operating system's Outlook mail handler without requesting Graph mail permissions; the user reviews and sends it from Outlook.
15. A completed agent response can be saved through an operating-system save dialog as a valid `.docx` file preserving its title, headings, paragraphs, lists, tables, and links where supported.

## 20. Risks and Mitigations

| Risk                                               | Impact                                    | Mitigation                                                                      |
| -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Azure CLI requirement conflicts with Teams hosting | Teams MVP cannot satisfy auth requirement | Use Electron for MVP; use Teams SSO/OBO later                                   |
| LinkedIn API access is unavailable or restricted   | External persona signals absent           | Feature flag; approved API only; no scraping; continue with internal sources    |
| Seismic auth model is not approved                 | Solution assets incomplete                | Use approved SharePoint assets and show partial-source status                   |
| MCEM portal content changes                        | Guidance becomes stale                    | Version content, track retrieval and effective dates, assign content owner      |
| MSX data is incomplete or stage labels are stale   | Incorrect coaching                        | Separate recorded stage from evidence-based assessment; ask for missing data    |
| Reused UI carries unrelated MSX Helper workflows   | Product feels cluttered                   | Reuse shell and components, not all existing features                           |
| Agent outputs become generic                       | Low field value                           | Golden scenarios require MCEM gaps, evidence, owners, priorities, and rationale |
| Restricted data leaks through logs or cache        | Security and compliance issue             | Minimize persistence, redact telemetry, keep tokens in trusted process memory   |

## 21. Open Decisions

These decisions must be resolved before implementation begins:

1. Confirm the MVP surface: Electron thin client as recommended, or Teams with a revised authentication requirement.
2. Confirm whether the four agents in this PRD are the intended product agents, or whether agents should instead map one-to-one to four account-team personas.
3. Identify the exact earlier Copilot project UI elements to reuse in addition to MSX Helper.
4. Confirm the MSX environment URL, tenant, supported entities, and read scopes.
5. Confirm the canonical MCEM document libraries/pages and the authorized content owner.
6. Confirm Seismic API entitlement and whether access is delegated per user or service-based.
7. Confirm LinkedIn product/API entitlement, permitted fields, retention, and display rules.
8. Select the model and agent runtime after access, data residency, and evaluation requirements are approved.
9. Define pilot population, data classification, retention period, and telemetry destination.
10. Confirm the October demonstration date and scope-freeze date.

## 22. Approval Gate

No implementation, scaffolding, connector registration, or infrastructure deployment should begin until stakeholders approve:

- The MVP product surface and authentication model.
- The four-agent capability map.
- The source access and compliance assumptions.
- The MVP scope and acceptance criteria.
