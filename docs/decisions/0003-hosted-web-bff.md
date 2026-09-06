# ADR 0003: Hosted Web Backend for Frontend

## Status

Accepted for the hosted web client. This decision extends, but does not replace, the Electron topology in ADR 0002.

## Context

The revamp renderer must run in both Electron and a multi-user browser deployment with nearly identical form and function. A browser cannot safely hold MSX or Foundry credentials, and static fixture hosting cannot provide live enterprise data.

## Decision

Host the shared renderer and a Node.js backend for frontend in one Azure App Service. The browser calls same-origin, contract-validated `/api` routes. Azure App Service Authentication authenticates each user and injects the user's delegated MSX access token into the server request.

The backend will:

- reject live API requests without both the App Service client principal and delegated access-token headers;
- create a new `LiveMsxConnector` and orchestrator for every request;
- keep all delegated tokens, Foundry credentials, and connector implementations outside the browser;
- use the App Service user-assigned managed identity for Microsoft Foundry;
- preserve the existing shared contracts and orchestrator policies;
- emit correlation IDs and sanitized client errors; and
- serve the same revamp renderer used by Electron.

App Service Authentication must have its token store enabled and request the approved delegated MSX scope. Its provider credential is a server-side secret. The browser must never call MSX, Microsoft Graph, or Foundry directly.

## Consequences

- Desktop behavior remains local and continues to use Electron IPC.
- Hosted web refreshes obtain a fresh request-scoped MSX connector, avoiding cross-user cache leakage.
- Foundry clients and deterministic guidance may be shared because they contain no delegated MSX state.
- App Service Authentication configuration and MSX delegated consent become deployment prerequisites.
- Server-side scheduling, durable workflows, and shared workflow state remain outside this decision.

## Security Constraints

- Require HTTPS and App Service Authentication for every hosted route except `/api/health`.
- Allow only same-origin browser API calls.
- Do not log access tokens, client-principal payloads, request bodies, or raw downstream errors.
- Assign the App Service identity only the minimum role required on the existing Foundry project.
- Retain `cache-control: no-store` on API and HTML responses.
