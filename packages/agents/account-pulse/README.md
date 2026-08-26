# Account Pulse Agent

Prioritizes weekly account and opportunity attention with explainable evidence-based rankings.

## Inputs

Versioned orchestrator context containing role, intent, accounts, opportunities, milestones, activity, source health, freshness, and ranking threshold.

## Outputs

Weekly focus or top-risk view using the shared response contract, with ranked actions, owners, rationale, confidence, and evidence references.

## Dependencies

Common contracts and orchestrator-supplied evidence. The agent has no connector credentials and performs no writes.

## Failure Behavior

Returns an unranked missing-data response below the evidence threshold. Preserves supported results and labels stale, partial, unavailable, or unauthorized sources.

## Owner

Account Pulse capability owner.