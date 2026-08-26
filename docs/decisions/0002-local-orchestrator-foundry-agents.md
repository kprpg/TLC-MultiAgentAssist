# ADR 0002: Local Orchestrator with Foundry Agents

## Status

Accepted for the Electron phases.

## Context

TLC has four logical agents: MCEM Coach, Risk and Solution Play, Pursuit Executive, and Account Pulse. The Electron application already instantiates the orchestrator in its trusted main process and exposes validated operations to the sandboxed renderer through a narrow preload API.

Microsoft Foundry will host and version the agent definitions. The desktop application does not currently require a shared web backend, centralized scheduling, or another client channel.

## Decision

Keep the TypeScript orchestrator in the Electron main process. The renderer remains a presentation layer and must not call Foundry or enterprise data sources directly.

The trusted main process will:

- validate renderer requests and agent responses with shared contracts;
- invoke the four Foundry agent endpoints through adapter interfaces;
- obtain and isolate user authentication tokens;
- coordinate MSX, SharePoint, and other approved connectors;
- enforce evidence, role-ownership, source-health, and read-only policies; and
- return only validated business contracts through preload IPC.

Keep deterministic MCEM evaluation in code. Foundry agents may perform reasoning, synthesis, and customer-ready drafting without replacing evidence validation or authorization checks.

Do not introduce Azure Container Apps for orchestration during the Electron-only phases.

## Authentication

Use delegated user authentication when downstream authorization must preserve the signed-in user's permissions. A Foundry agent identity or Azure managed identity must not be treated as a substitute for user-delegated MSX or Microsoft Graph access.

No access token, Foundry credential, raw IPC capability, or connector implementation may be exposed to the renderer.

## Reconsideration Triggers

Reconsider a remote orchestrator only when at least one of these requirements is approved:

- Teams, web, or another client must share the same orchestration;
- Account Pulse or another workflow must run on a server-side schedule;
- workflows need shared state, durable execution, webhooks, or centralized caching;
- orchestration updates must be deployed independently of desktop releases; or
- centralized throttling, policy enforcement, or network isolation cannot be met locally.

If a remote orchestrator is introduced, preserve the existing contracts and adapter boundaries so the Electron renderer does not change materially.

## Consequences

- The current runtime topology remains valid and no hosting migration is required.
- Foundry integration can be added incrementally behind the orchestrator.
- Desktop releases carry orchestration changes until a reconsideration trigger is met.
- Central scheduling and multi-channel access remain intentionally deferred.