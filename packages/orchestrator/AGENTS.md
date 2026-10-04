# AGENTS.md — Orchestrator (harness layer)

The runtime that turns requests into grounded results: `workflows/` (host, runtime, registry,
cohort executor, deterministic + composite modes), `routing/`, `policies/`, `progress/`, plus
`ThinSliceOrchestrator` (agent tasks, MCEM evaluation, write paths). Inherits the root AGENTS.md.

## Rules
- **Parse at the edges.** Validate inputs and assemble outputs with `packages/common` zod schemas;
  return schema-valid results (`initialWorkflowOutputSchema`, `agentTaskResponseSchema`, …).
- **Agents stay read-only.** They are invoked through the `TaskAgentRegistry` with
  orchestrator-assembled context (opportunity context + MCEM guidance + local evaluation). Never let an
  agent call tools directly or mutate records.
- **Evidence & health.** Carry `McpEvidenceLineage` + `sourceHealth` through to results; mark runs
  `partial`/`unauthorized` honestly; `evidenceIds` must trace to real sources.
- **Writes are explicit & guarded.** Mutations go through the dedicated update paths
  (`updateOpportunity`/`updateMilestone`/`transitionOpportunityStage`), enforce the MCP
  tool-authorization policy and delegated scope, and are auditable. The `changeSet*` contracts are the
  intended path for reviewed, proposed batch writes.
- Keep **deterministic** and **composite** workflow behavior stable; cover changes with
  `tests/unit/orchestrator` and `tests/contract`.
