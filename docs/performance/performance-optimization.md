# Performance Optimization

## Summary

This pass addressed two reported latency areas: initial MSX population and explicit Microsoft Foundry workflows. It used a conservative approach that removes avoidable work, reuses existing clients, and adds phase-level measurements without changing the user-facing workflow.

## Changes

### Local startup diagnostic

The automatic MCEM diagnostic no longer invokes Foundry. It now builds the diagnostic from the cached MSX context, local MCEM guidance, and deterministic local evaluation.

Previously, startup waited for a Foundry model response even though that response was discarded. Explicit Account Pulse, MCEM Coach, Pursuit and Executive, and Risk and Solution Play actions remain Foundry-backed.

### Shared Foundry client

The four workflow agents now reuse one authenticated OpenAI client created from one `AIProjectClient`. This avoids creating a separate project/client pipeline for every agent binding and preserves reuse of the existing Foundry credential.

### Existing source caches

The optimization retains the existing process-level caches:

- MSX portfolio hydration is memoized after its first request.
- Local MCEM PDF parsing and validation are memoized.
- The Azure CLI MSX token is cached until five minutes before expiration.

## Measurements

Operations use `performance.now()` and emit elapsed time in milliseconds plus a success or failure outcome. The Electron main process writes structured logs in this form:

```text
[performance] {"operation":"agent.invoke.mcem-coach","durationMs":2345.6,"outcome":"success"}
```

No prompt text, response content, customer names, identifiers, access tokens, or token counts are logged.

### MSX phases

| Operation           | Measurement                |
| ------------------- | -------------------------- |
| `msx.identity`      | MSX `WhoAmI` request       |
| `msx.deal-team`     | Active deal-team retrieval |
| `msx.opportunities` | Opportunity retrieval      |
| `msx.accounts`      | Parent-account retrieval   |

### Agent phases

| Operation                   | Measurement                                  |
| --------------------------- | -------------------------------------------- |
| `agent.context.msx`         | Selected opportunity context retrieval       |
| `agent.context.mcem`        | Local MCEM guidance retrieval                |
| `agent.invoke.<capability>` | Foundry invocation for the selected workflow |

The timing reporter cannot interrupt the measured operation. Reporter failures are ignored, while operation failures are recorded and rethrown normally.

## Results

The dominant avoidable startup operation was removed: automatic diagnostics no longer wait for a discarded Foundry response. Client initialization overhead was also reduced by sharing one Foundry client across all four workflows.

A controlled before-and-after live benchmark has not yet been captured, so no percentage latency reduction is claimed. The packaged Electron smoke test completed in 8.1 seconds after the changes, but this is a full UI test and is not a direct startup or Foundry latency benchmark.

Validation completed after the change:

- TypeScript typecheck passed.
- All 40 automated tests passed.
- The packaged Electron smoke test passed.

## Benchmark Procedure

Use the same identity, network, MSX portfolio, Foundry project, and agent prompt for each run. Capture at least one cold launch and five warm runs.

1. Launch the desktop app in live mode and collect all `[performance]` log entries.
2. Record each MSX phase and their sum for initial hydration.
3. Run each Foundry workflow with a fixed prompt.
4. Record `agent.context.msx`, `agent.context.mcem`, and `agent.invoke.<capability>`.
5. Report median and 95th-percentile duration separately for cold and warm runs.
6. Compare against a baseline collected under the same conditions.

Do not use the packaged smoke duration as a substitute for these phase metrics.
