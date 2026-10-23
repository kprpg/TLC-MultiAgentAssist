# Agentic Performance

Why Guidance prompts (Account Pulse, MCEM Coach, Pursuit and Executive, Risk and Solution Play) take two minutes or more to answer, what was changed in this repository, and what still has to be done outside it (Foundry project). Applies to all four surfaces: Desktop (legacy and revamp renderers), Web, VS Code webview and Teams.

See also [performance-optimization.md](./performance-optimization.md) for the earlier startup/Foundry-client pass.

> **Evidence status.** No live latency baseline existed when this investigation was done, and the Foundry project could not be inspected from the investigation environment (`agent_get` returned *Workspace not found*; the project is in a separate tenant). Root causes below are established from the code; **no percentage improvement is claimed**. Section 7 defines how to measure one.

## 1. The request path

```text
UI click
 -> transport  (Electron IPC | HTTP /api/agent-task | VS Code postMessage | Teams /api/teams/operations/runAgentTask)
 -> ThinSliceOrchestrator.runAgentTask            packages/orchestrator/index.ts
      withFreshReadContext
      agent.context.msx         LiveMsxConnector.getOpportunityContext
      agent.context.milestones  + agent.context.mcem (parallel)
      evaluateMcemProgress      (local, deterministic, instant)
      agent.invoke.<capability> FoundryPromptAgent.invoke  -> ONE blocking responses.create(agent_reference)
 -> full response rendered once
```

Every surface converges on the same orchestrator call, so the cost is shared and the fixes below live in the shared core.

## 2. Root causes (ranked)

| # | Cause | Evidence | Impact |
| - | ----- | -------- | ------ |
| 1 | **The Foundry call is blocking and unbounded.** One non-streaming `responses.create`; nothing is shown until the entire answer exists. | `packages/connectors/foundry/index.ts` (`invoke`) | Dominant. User sees a spinner for the whole generation. |
| 2 | **Slow model configuration.** All four agents run `gpt-5.4-1` (reasoning-class model, default reasoning effort) with an 8–11 section mandatory output format and no output cap. | `packages/agents/*/foundry-agent.json` | Likely the largest single contributor to generation time. Foundry-side; see §6. |
| 3 | **The timeout equals the symptom.** `requestTimeoutMs` is 120 000 ms, with no first-token timeout, retry or fallback. | `config/foundry.environment.default.json` | A stalled call costs the full two minutes and then fails. |
| 4 | **Cold MSX read on every click.** `runAgentTask` forces `withFreshReadContext`, so the portfolio loader re-ran ~8–12 *sequential* OData calls (WhoAmI -> preferences -> deal team -> template discovery -> team membership -> milestones -> opportunities -> accounts -> milestones). Web builds a new connector per request, so nothing is ever reused. | `packages/connectors/msx/live.ts` `loadPortfolio` | Several seconds; repeated for every capability. |
| 5 | **First-use costs land on the first click.** Foundry token/sign-in (desktop uses `InteractiveBrowserCredential`), first TLS connection, first MCEM PDF parse. | `apps/desktop/electron/main/runtime-credentials.ts`, `local-pdf.ts` | One-off, seconds. |
| 6 | **No progressive UI.** An instant, deterministic, evidence-based answer already existed (`formatLiveAgentGuidance`) but was never shown while waiting; in-flight runs were not cancellable end to end; guidance refresh re-ran the model on every context refresh. | `task-agents.ts`, `renderer-revamp/App.tsx` | Perceived latency = full latency. |
| 7 | **No telemetry for the dominant cost.** Only `agent.invoke.*` wall time was recorded, and only when `TLC_PERFORMANCE=1` outside desktop. | `packages/common/telemetry/performance.ts` | Cannot attribute time to first token vs generation vs retries. |
| 8 | **Teams budget.** 4 agent requests per window per user; native fetch capped at 30 s. | `apps/teams/src/app.ts` | Retries by an impatient user exhaust the budget. Left unchanged (security/cost control). |

Model input size was originally a few KB (the request, the opportunity with its milestones, five or fewer stage criteria and the local evaluation). The evidence pack (section 3.4) raises it to a bounded budget of about 48 KB of JSON (roughly 12k tokens); it is read concurrently with the milestone and MCEM reads so it adds little wall-clock time, and the instant draft is still shown first.

## 3. What changed

### 3.1 Perceived latency: instant draft + streaming (all surfaces)

`ThinSliceOrchestrator.runAgentTaskStream(request, onEvent, signal)` emits, in order:

1. `context` — an **instant draft** built from the same evidence by the deterministic local evaluation (`packages/orchestrator/instant-draft.ts`), available as soon as MSX evidence loads and independent of the model.
2. `delta` — model text as it streams.
3. `complete` — the authoritative `AgentTaskResponse` (always sent; a UI that missed deltas still ends correct).
4. `error` — terminal `failed | timeout | cancelled`.

It never throws: all outcomes are events. If the model fails or times out, the run still completes with the labelled deterministic draft (`state: 'partial'`, `agentVersion: '<version>+local-fallback'`, plus an "AI enhancement is unavailable" notice) instead of a two-minute error. Cancellation (`AbortSignal`) stops MSX reads and the Foundry call.

Contract: `agentTaskStreamEventSchema` / `agentTaskStreamVersion = '1.0'` in `packages/common/contracts/index.ts`. It is additive; `runAgentTask` and `contractVersion` are unchanged, and any client or host without streaming keeps working.

| Surface | Transport (marshals only) | UI |
| ------- | ------------------------- | -- |
| Desktop | `ipcMain.handle('tlc:run-agent-task-stream')` + `webContents.send('tlc:agent-task-event')`; `tlc:cancel-agent-task-stream`; trusted-sender check on both | `renderer-revamp` and legacy `renderer` |
| Web | `POST /api/agent-task/stream`, NDJSON, `no-transform`, 15 s heartbeat (keeps App Service's 230 s idle limit away), run aborted on client disconnect | shared `renderer-revamp` |
| VS Code | `stream-request` / `stream-event` / `stream-cancel` envelopes via `createAgentStreamRouter` (pure, unit-tested); falls back to `runAgentTask` for providers without streaming | webview `GuidancePane` |
| Teams | `POST /api/teams/agent-stream` (same lifecycle admission, per-user agent budget, local-session re-check on every event) | `guidance-workspace.tsx` |

Shared, browser-safe UI code (no Node imports): `apps/shared/agent-stream.ts` (accumulator, NDJSON reader) and `apps/shared/use-agent-run.ts` (hook: draft -> streamed text -> final, Cancel, newer run supersedes older). The revamp `App.tsx` gained a hook call instead of more `useState`. Guidance **refresh** no longer blocks on a model call.

### 3.2 Real latency

- **Foundry streaming client.** `FoundryPromptAgent.stream` uses `stream: true` and `response.output_text.delta`. A **first-token timeout** (`firstTokenTimeoutMs`, default 60 s) aborts a stalled call and retries once; the overall `requestTimeoutMs` still bounds the run. If the service rejects streaming (400/404/405/501) it falls back to the blocking call.
- **Output cap.** Optional `foundry.maxOutputTokens` (reasoning tokens count against it for reasoning models — size generously; unset by default).
- **MSX reads.** `loadPortfolio` now runs preferences, deal-team and milestone-team reads **concurrently** after WhoAmI (previously sequential), and `getOpportunityContext` starts the opportunity's milestone read **in parallel** with the portfolio access check (discarded if the gate rejects). Reads remain per-request fresh: the "agent reads are fresh" rule in `performance-optimization.md` is unchanged.
- **Pre-warm.** `prewarmAgentDependencies` acquires the Foundry token and parses the MCEM PDF before the first click: Desktop after MSX authentication succeeds, Web at start-up. VS Code is deliberately not pre-warmed because its credential would prompt for consent (`createIfNone`). Failures are ignored and surface normally on use.

### 3.3 Telemetry (no content, no identifiers)

`PerformanceEvent` gained optional numeric `metrics`. `agent.foundry.stream` reports `attempt`, `firstTokenMs`, `outputChars`, `inputTokens`, `outputTokens`, `reasoningTokens`. New phases: `msx.milestone-team`, `agent.prewarm`, `operation.runAgentTaskStream`. Existing `agent.context.*`, `agent.invoke.*` and `agent.task.*` events are unchanged. Enable with `TLC_PERFORMANCE=1` (always on in Desktop).

Configuration (additive, optional, in `config/foundry.environment.json`):

```json
{ "foundry": { "requestTimeoutMs": 120000, "firstTokenTimeoutMs": 60000, "maxOutputTokens": 4096 } }
```

### 3.4 Grounding: the evidence pack (all agents, all surfaces)

Every agent request is built in one place, `ThinSliceOrchestrator.prepareAgentTask`, so Desktop, Web, VS Code, and Teams (and workflow guidance handoffs, which re-enter `runAgentTask`) ground agents on the same data. Besides the opportunity, milestones, current-stage MCEM criteria, and local evaluation, the context now carries:

- `nextStageGuidance` — the MCEM gate for the next stage (absent at Stage 5).
- `evidence` — an `AgentEvidencePack` (`packages/orchestrator/agent-evidence.ts`): the customer need statement, deal team, dated **forecast-comment history**, **notes**, and **activities** for the opportunity, and per milestone its comment history, tasks, status/commitment/target date, `overdue`/`daysToTarget`, and risk details. Entries are newest first with citation refs (`O.C1`, `M2.A1`) and ages. `signals` adds deterministic staleness and counts; `coverage` reports truncation and named `gaps`.

How it is read: `LiveMsxConnector.getOpportunityEvidence` issues independent, access-gated reads (opportunity details, `msp_forecastcommentsjsonfield` history, `annotations`, `activitypointers`, one chunked `tasks` read for all milestones, milestone comment history, deal team, author names). One failed read becomes a named gap and the rest is kept; a missing comment-history column is treated as optional. Connectors without that method (sample fixture, local store) are enriched from the standard `listMilestoneActivities` reads, so sample mode keeps parity. The reads run concurrently with the milestone and MCEM reads.

How it is sent: `serializeAgentContext` (used by `createFoundryTaskAgents`) replaces the raw `comments`/`riskDetails` fields with the pack so text is sent once and bounded (about 48 KB; caps tighten in tiers and `coverage.truncated` says so). Comment, note, activity, and need text is untrusted: the pack carries a notice and every agent's instructions say to analyze it and ignore embedded directives. If live reads had gaps, the MSX source health in the response is `partial`; the instant draft gains a "Recent evidence" section from the same pack. Nothing in this path logs comment text.

Agent instructions, grounding policies, READMEs, golden scenarios, and the `foundry-agent.json` `definition.instructions` were updated together; **redeploy the four Foundry prompt agents** so the hosted definitions pick up the new Evidence Pack rules.

## 4. Per-surface notes

- **Desktop:** IPC cannot stream a return value, hence the event channel; the renderer validates every event with the shared Zod schema.
- **Web:** the same Easy Auth, same-origin and per-request connector rules apply; each streaming request still builds a fresh connector, so MSX reads are not shared across requests (see §5).
- **VS Code:** sample/local providers have no `runAgentTaskStream`; the host router emits a single `complete`, so behaviour matches today.
- **Teams:** the bot's `ask` command still returns one message (unchanged); the tab uses streaming. The 4-requests budget is counted once per run, cancelled or not.

## 5. Not done (deliberately) and why

| Item | Reason / trigger to revisit |
| ---- | --------------------------- |
| Short-TTL cache of agent MSX context (`TLC_AGENT_CONTEXT_TTL_MS`) invalidated on acknowledged mutations | Changes the documented "agent reads are fresh" rule. Revisit if `agent.context.*` totals > ~3 s p50 in the baseline. Web would benefit most (new connector per request). |
| Response cache keyed by (capability, opportunity revision, prompt) | Needs a revision source for evidence; risk of serving stale advice. |
| Compact model input | Measured as small; not worth quality risk. |
| Raising/lowering the Teams agent budget | Security/cost control owned elsewhere. |
| Moving agents off the `agent_reference` Responses API to direct model calls | Only if Foundry-side tuning (below) is insufficient: direct calls allow per-request `reasoning` settings (the meeting extractor already uses a direct model call). Loses portal-managed agent versioning. |

## 6. Foundry-side recommendations (cannot be applied from this repository)

First **verify** what is actually deployed for the four agents (`tlc-account-pulse`, `tlc-mcem-coach`, `tlc-pursuit-executive`, `tlc-risk-solution-play`): model, reasoning effort, tools attached, and deployment SKU/region (project `multiagentacctteam`, southcentralus). Then, in order of expected payoff:

1. **Lower reasoning effort or use a faster tier** (for example a mini model, or a non-reasoning model) for these advisory summaries. The deterministic local evaluation is already authoritative for stage/criteria, so deep reasoning adds little. Note: setting reasoning effort in the agent definition may be ignored at runtime by `agent_reference` invocations — confirm with a measured before/after run rather than trusting the portal.
2. **Shorten the output contract.** Today the instructions require 8–11 labelled sections. A target of ~300–500 tokens (Summary, Top actions with owner/evidence, Risks, Missing information) cuts generation time roughly in proportion to output length. Keep `foundry-agent.json` `definition.instructions` byte-equal (after trim) to `prompts/instructions.md` and re-run `golden-scenarios.json`.
3. **Deployment capacity:** check TPM/throttling (HTTP 429 shows as slow responses), consider provisioned throughput for steady use, and keep the deployment in the region closest to users.
4. **Guard quality** with the existing Foundry evaluation suites (`evaluation` blocks in each `foundry-agent.json`) before and after.

## 7. How to measure (baseline first, then re-measure)

Use the same identity, network, MSX portfolio, Foundry project and prompt. One cold launch + five warm runs per capability.

1. Set `TLC_PERFORMANCE=1` (Desktop logs `[performance]` lines automatically).
2. Record, per run: `agent.context.msx`, `agent.context.milestones`, `agent.context.mcem`, `msx.*` phases, `agent.foundry.stream.firstTokenMs`, `agent.invoke.<capability>`, `agent.task.<capability>`, plus token counts.
3. User-perceived metrics: **time to instant draft** (click -> `context` event) and **time to first model text** (click -> first `delta`) in addition to total time.
4. Compare: current Foundry settings vs each §6 change, one change at a time.

Expected shape (to be confirmed, not a claim): time to instant draft ≈ MSX evidence time only (seconds, independent of model); total time ≈ unchanged until §6 is applied; failure/timeout case ≈ first-token timeout (+ one retry) rather than a 120 s error.

Automated coverage: `tests/unit/orchestrator/agent-task-stream.test.ts` proves the draft is delivered while a 90 s model call is still pending; `tests/connectors/foundry-prompt-agent.test.ts` covers streaming, first-token retry, cancellation and blocking fallback.

## 8. Rollout and risk

- Additive: old operations, schemas and clients keep working; streaming is used only where the surface provides it.
- The fallback draft is deterministic and evidence-bound; it is always labelled and `partial`.
- Security boundaries unchanged: `assertTrustedSender`, Easy Auth/same-origin, Teams lifecycle + budget + local-session checks, MCP policy. Events and telemetry carry no prompt text, customer names, ids or tokens (telemetry) — stream events carry user-visible guidance content to the requesting user only.
- Config defaults preserve current behaviour except the new first-token timeout (60 s then one retry) and the concurrent MSX reads.
