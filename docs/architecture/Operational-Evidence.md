# Operational Evidence

Separates what was **executed** from what is **planned but not executed**. Numbers are from sample mode
on a developer machine and are indicative only; they are not production capacity claims.

## Executed

| Check | Where | Result |
| --- | --- | --- |
| Golden-scenario evaluation, deterministic fallback (4 prompt agents) | `tests/unit/orchestrator/golden-scenario-orchestration.test.ts` -> `test-results/golden-evaluation-deterministic.json` | Per agent: 1 expectation accepted, 1 rejected, 14 not evaluated; outcome `failed` for all four. Fallback output does not meet the shared presentation expectations, and the behavioral expectations are not judged offline. |
| Golden evaluator semantics | `golden-scenario-evaluation.test.ts` | `not-evaluated` is never counted as a pass; reports are metadata-only. |
| 25 concurrent users x 4 requests, sample mode | `concurrency-isolation.test.ts` -> `test-results/concurrency-evidence.json` | No cross-user content bleed; p50 about 4 ms, p95 about 18 ms, heap growth about 13 MB (last run). Timing is not asserted tightly. |
| Overload and eviction | `workflow-runtime.test.ts`, `web-workflow-host-cache.test.ts`, `workflow-transport-parity.test.ts` | Active runs are never evicted; 429 on capacity. |
| Hosting model guard, unknown run after restart/other instance | `hosting-model.test.ts` | Fails closed; `run_not_found` / 404. |
| Import boundaries | `npm run check:boundaries` | Forbidden dependencies fail; 3 baselined exceptions can only shrink. |

`test-results/` is gitignored; rerun the tests to regenerate the reports.

## Planned, not executed

- **Live Foundry golden evaluation**: opt-in via `TLC_RUN_LIVE_EVAL=1`; the harness exists but was not run. Behavioral expectations still need a model-quality judge or human review.
- **Agent version provenance**: the deployed agent version is not verified or recorded. The Responses API pinning behavior is unverified, so no version is claimed.
- **Deployed authentication, failover, and restart behavior** on the real App Service.
- **Load and resource targets** beyond the in-process sample-mode run above, including live connector latency.
- **Live Seismic/Graph access** (connection id, consent, property mapping).
