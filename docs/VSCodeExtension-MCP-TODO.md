# VS Code Extension MCP TODOs

Status: Proposal validation backlog  
Date: 2026-09-15  
Rule: Do not implement these items until the VS Code extension proposal is explicitly approved and scoped.

## Gate 1: Confirm Accepted MCP Client Identity

- [ ] Confirm with MSX/Dataverse MCP owners whether Visual Studio Code client ID `aebc6443-996d-45c2-90f0-388ff96faa56` is allowlisted for `https://microsoftsales.crm.dynamics.com/api/mcp`.
- [ ] Determine whether GitHub Copilot Chat in VS Code uses the same client ID for Dataverse MCP tool calls.
- [ ] Find a supported way to inspect non-secret token claims or MCP auth diagnostics for the successful VS Code/Copilot query path.
- [ ] Record whether Azure CLI client ID `04b07795-8ddb-461a-bbee-02f9e1bf7b46` remains blocked or can be allowlisted for read-only MCP.

## Gate 2: Validate Production MCP Discovery

- [ ] Run a production `initialize` and `tools/list` probe using the accepted VS Code/Copilot client path.
- [ ] Classify advertised tools into logical TLC tiers: `dataverse-mcp` broad retrieval and `msx-mcp` curated seller workflows.
- [ ] Capture sanitized tool names, input schemas, output shapes, and required scopes.
- [ ] Update the capability-binding evidence in [DataverseMCP-MergedDecisionBrief.md](DataverseMCP-MergedDecisionBrief.md) without recording tokens or sensitive row data.

## Gate 3: Map TLC Workflows to Available MCP Tools

- [ ] Map `WF-001` stale opportunity sweep to available Dataverse/MSX MCP operations.
- [ ] Map `WF-002` overdue milestone triage.
- [ ] Map `WF-003` stage-evidence mismatch queue.
- [ ] Map `WF-005` weekly governance exceptions.
- [ ] Map `WF-006` commit-risk conflict list.
- [ ] Map `WF-007` next-meeting prep pack.
- [ ] Map `WF-009` owner workload imbalance.
- [ ] Map `WF-010` activity follow-up debt.
- [ ] Map `WF-012` stage exit evidence packet.
- [ ] Identify any workflow that needs a missing entity, field, tool, or user privilege.

## Gate 4: Validate User Privilege Behavior

- [ ] Document the `prvReadDVTableSearch` gap encountered when calling `describe("scopes/")`.
- [ ] Determine whether TLC needs DVTableSearch scope discovery or can rely on fixed workflow schemas and table descriptions.
- [ ] Test read-only Opportunity, Account, Milestone, Activity, and Forecast queries under least privilege.
- [ ] Confirm unauthorized and partial states are distinguishable from empty data.

## Gate 5: Choose VS Code Extension Auth Model

- [ ] Decide whether TLC should consume VS Code MCP server definitions, register its own MCP server definition provider, or call MCP directly from the extension host.
- [ ] Validate whether direct extension-host calls can reuse VS Code authentication without a TLC-owned app registration.
- [ ] Keep tokens in the extension host only; never pass tokens to a webview.
- [ ] Define fallback behavior for sample mode and non-MCP MSX access.

## Gate 6: Extension Product Shape

- [ ] Define the first VS Code surface: webview workbench, sidebar view, command palette workflows, or chat participant.
- [ ] Preserve both TLC modes: opportunity guidance and portfolio operations.
- [ ] Decide whether the Workflow Launcher should be the first VS Code entry point.
- [ ] Define how Workflow Runs, Operational Queue, Source Health, and Agent Guidance handoff appear in VS Code.

## Gate 7: Security and Governance Review

- [ ] Reconfirm delegated-user-only access for customer data.
- [ ] Preserve default-deny MCP tool policy.
- [ ] Keep write tools disabled unless a separate governed-write decision is approved.
- [ ] Ensure telemetry records metadata only: IDs, counts, latency, source state, and errors without raw sensitive payloads.
- [ ] Validate webview CSP, message validation, and restricted local resource loading before any pilot.

## Gate 8: Pilot Readiness

- [ ] Run sample-mode workflow tests in the extension host.
- [ ] Run read-only live MCP smoke tests behind an explicit feature flag.
- [ ] Verify portfolio workflow latency and partial-result UX.
- [ ] Create a rollback plan that disables live MCP while leaving sample mode available.
- [ ] Document pilot prerequisites for users: VS Code version, Copilot/MCP availability, account permissions, and expected Dataverse privileges.
