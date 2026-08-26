# Pursuit and Executive Agent

Creates executive meeting briefs and 30/60 day pursuit plans from grounded account intelligence and MCEM gaps.

## Inputs

Versioned orchestrator context containing intent, role, account and opportunity evidence, source health, and optional MCEM Coach handoff.

## Outputs

Executive brief or pursuit plan with facts, internal strategy, actions, owners, proof points, agenda, sources, and review-required draft text.

## Dependencies

Common contracts and orchestrator-supplied evidence or handoffs. The agent never invokes another agent or performs writes.

## Failure Behavior

Asks for missing critical context or clearly scopes a partial result. It does not fabricate activity, sponsors, commitments, dates, or proof points.

## Owner

Pursuit and Executive capability owner.