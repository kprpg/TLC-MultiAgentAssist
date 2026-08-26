# MCEM Coach Agent

Explains evidence-based MCEM stage diagnostics while preserving deterministic local evaluation authority.

## Inputs

Versioned orchestrator context containing opportunity evidence, current MSX stage, versioned MCEM guidance, role, source health, and local evaluation.

## Outputs

Stage divergence, exit-criteria evidence, gaps, actions, owners, rationale, sources, and a structured Pursuit handoff.

## Dependencies

Common contracts, local MCEM evaluator, and orchestrator-supplied evidence. The agent has no connector credentials and performs no writes.

## Failure Behavior

Does not infer completion from the stage label. Missing or stale evidence produces explicit uncertainty and requests, while the local evaluation remains unchanged.

## Owner

MCEM Coach capability owner.