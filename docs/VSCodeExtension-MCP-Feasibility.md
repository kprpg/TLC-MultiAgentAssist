# VS Code Extension MCP Feasibility

Status: Investigation note  
Date: 2026-09-15  
Scope: Feasibility of running TLC MultiAgent Assist portfolio and opportunity workflows from a VS Code extension without the Azure App Service Entra app-registration blocker.

## Summary

A VS Code extension remains a feasible host for TLC MultiAgent Assist. The strongest reason is that the TLC core already separates host-neutral packages from Electron and web shells: contracts, orchestrator logic, agents, connectors, workflow runtime, and MCP adapters live under `packages/`.

The extension path is especially relevant because the Azure App Service web version depends on App Service Authentication, which in turn requires an Entra app registration, token-store configuration, and consent for delegated MSX access. That was difficult to make meaningful in the Microsoft Corp tenant because the required app registration/admin consent path was blocked.

A VS Code extension would not need Azure App Service Authentication. It can run the trusted TLC host logic locally in the VS Code extension host and communicate with a webview UI through VS Code message passing. Tokens and MCP calls can stay out of the webview, preserving the current TLC trust model.

## Key Finding

From this Copilot/VS Code session, a live read-only Dataverse MCP query succeeded against the Microsoft Sales Dataverse environment. This supports the hypothesis that the VS Code/Copilot MCP path can reach Dataverse without a TLC-owned App Service app registration.

The successful proof was a bounded read-only Opportunity query:

```sql
SELECT TOP 1 opportunityid, name, estimatedvalue, estimatedclosedate, msp_activesalesstage
FROM opportunity
ORDER BY modifiedon DESC
```

The query returned one Opportunity row. The result is not copied here because the purpose of this note is feasibility, not data capture.

Additional observations:

- `search("opportunity")` succeeded and returned Opportunity-related table schemas.
- `describe("tables/opportunity")` succeeded and returned the Opportunity schema.
- `describe("scopes/")` reached Dataverse but failed because the delegated user lacks `prvReadDVTableSearch` on `dvtablesearch`. That is a Dataverse privilege gap, not evidence of OAuth client rejection.

## Client Identity Evidence

Microsoft documentation for securing MCP servers for Visual Studio Code identifies this Visual Studio Code client ID:

```text
aebc6443-996d-45c2-90f0-388ff96faa56
```

The current repo records a separate failed production probe in [DataverseMCP-MergedDecisionBrief.md](DataverseMCP-MergedDecisionBrief.md):

```text
Azure CLI client ID: 04b07795-8ddb-461a-bbee-02f9e1bf7b46
Endpoint: https://microsoftsales.crm.dynamics.com/api/mcp
Outcome: HTTP 403 because the Azure CLI application was not an allowed MCP client.
```

Taken together:

- Azure CLI is not currently proven viable for production MSX/Dataverse MCP because it was rejected by client allowlist.
- The Copilot/VS Code MCP path is proven capable of live Dataverse reads from this session.
- The actual OAuth token claims for the successful query were not exposed by the MCP tool, so the accepted client ID is strongly suggested but not cryptographically confirmed from this session.

## What This Proves

The investigation proves that a VS Code/Copilot MCP path can run live Dataverse reads for the signed-in user. That is the important product feasibility signal: the VS Code route can avoid the specific App Service Easy Auth app-registration/admin-consent dependency that blocked the hosted web version.

It also proves the result remains delegated-user scoped. The failed `scopes/` catalog call returned a Dataverse privilege error for the signed-in principal, which means Dataverse is enforcing the user's actual privileges rather than broadening access.

## What This Does Not Prove

This does not yet prove that a custom TLC VS Code extension can directly acquire and present the same accepted token on its own.

Open questions remain:

- Whether the accepted client for the successful Copilot/VS Code MCP query is exactly `aebc6443-996d-45c2-90f0-388ff96faa56`.
- Whether a custom TLC extension can reuse the same VS Code MCP authentication path directly, or must register MCP server definitions and let VS Code perform the OAuth challenge flow.
- Whether MSX Sales and Dataverse MCP expose all required tools for TLC workflows through the same accepted client path.
- Whether `tools/list` can be captured from production and bound to TLC's logical `dataverse-mcp` and `msx-mcp` operations.

## TLC Architecture Fit

The existing code is already close to the needed extension architecture.

Relevant components:

- [../packages/orchestrator/workflows/configured-host.ts](../packages/orchestrator/workflows/configured-host.ts) accepts a host-provided `getAccessToken(server)` function.
- [../packages/connectors/mcp/index.ts](../packages/connectors/mcp/index.ts) injects `Authorization: Bearer <token>` into MCP HTTP calls.
- [../packages/connectors/dataverse-mcp/adapter.ts](../packages/connectors/dataverse-mcp/adapter.ts) normalizes Dataverse MCP reads into TLC contracts.
- [../packages/connectors/msx-mcp/adapter.ts](../packages/connectors/msx-mcp/adapter.ts) normalizes curated MSX MCP reads into TLC contracts.
- [../packages/orchestrator/workflows/cohort.ts](../packages/orchestrator/workflows/cohort.ts) defines portfolio/account/opportunity workflows.
- [../apps/desktop/renderer-revamp/src/App.tsx](../apps/desktop/renderer-revamp/src/App.tsx) already includes Workflow Launcher UI state, filters, run history, operational output, and handoff to guidance.

For a VS Code extension, the extension host would replace the Electron main process or web BFF, while a webview would replace the renderer shell. The MCP token provider is the critical plug-in point.

## Recommended Auth Direction

The preferred direction is not to use Azure CLI for MCP unless the Azure CLI client is explicitly allowlisted.

Preferred options, in order:

1. Use VS Code's native MCP authentication flow and register or consume MCP server definitions so VS Code obtains the accepted token.
2. Use VS Code authentication or `VisualStudioCodeCredential` only if it can obtain a token accepted by `https://microsoftsales.crm.dynamics.com/api/mcp`.
3. Use Azure CLI only for existing non-MCP MSX paths, or after the Azure CLI client ID is explicitly allowlisted for MCP.

## Conclusion

The investigation materially strengthens the VS Code extension proposal. The successful live read-only query shows that Copilot/VS Code can access Dataverse through an accepted MCP path while preserving delegated-user authorization.

The next gate is not general feasibility. The next gate is proving the exact client identity and token flow a custom TLC VS Code extension can use, then binding production `tools/list` output to the current TLC workflow contracts.
