# Hosting Model

TLC MultiAgent Assist declares a **single-instance** hosting model for the Web and Teams hosts. This is
enforced at startup, not just documented.

## Declared model

| Concern | Behavior |
| --- | --- |
| Instances | One process serves a given deployment. Set `TLC_HOSTING_MODEL=single-instance` (the App Service deploy script does this). Any other value fails startup and the error names the supported value. |
| Workflow runs | Run state and history are process-local. A run started on one process is unknown to another. |
| Restart | In-flight and retained runs are lost on restart. Polling a pre-restart run id returns `run_not_found` (HTTP 404 on Web). |
| Replicas | Scaling out is **not supported**. A run id presented to a different instance returns `run_not_found`. |
| Preference files | The JSON preference store is safe only within one process. Concurrent updates within the process are serialized; multiple processes writing the same file are not protected. |
| Reporting cache | Per-user hosts are cached with a cap of 50 users. Eviction removes idle hosts only; when every cached host is busy a new user receives `capacity_exceeded` (HTTP 429, `retry-after: 5`). |

## Overload behavior

- Retained history is bounded and only **finished** runs are evicted; queued and running runs are never
  dropped.
- Active admission is bounded separately by `maxActiveRuns` (default 100). `start()` rejects with
  `WorkflowRuntimeError('capacity_exceeded')`, mapped to 429 on Web and Teams.

## Moving beyond single-instance

Multi-replica operation requires shared workflow state, run ownership/leases, shared preference
storage, and cancellation routing. None of this exists today; it should be scoped as its own change
with replica start/poll/cancel and restart tests.

Code: `packages/common/configuration/hosting-model.ts`, `packages/orchestrator/workflows/runtime.ts`,
`apps/web/src/runtime.ts`. Tests: `tests/unit/hosts/hosting-model.test.ts`.
