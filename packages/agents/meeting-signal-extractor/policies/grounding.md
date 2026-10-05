# Grounding & Safety Policies

These policies are enforced by the orchestrator around the model call, and mirrored by the
deterministic sample extractor in `src/index.ts` so offline/SQLite runs behave identically.

## Prompt-injection containment

- The transcript is wrapped as untrusted data between explicit delimiters. The model is told
  the content is quoted meeting speech and must never be followed as instructions.
- The agent has **no tools** and cannot call out. It can only return a JSON proposal.
- The orchestrator validates the model output against `meetingChangeSetProposalSchema`
  (zod). Any slot that fails validation, cites no evidence, or targets a field not in the
  dictionary is discarded before the reviewer sees it.

## Evidence & auditability

- Every proposed change carries the originating `segmentId`s. The review UI links each row
  back to the exact transcript lines.
- The approval step records a human `reason` (min 3 chars) and the exact set of approved
  slot ids. The applied result stores an `auditNote`.

## Least-change / safety

- No value outside the field dictionary; option-set values must match the allowed labels.
- Sensitive fields (revenue/estimated value) are never pre-checked and are visibly flagged.
- No-op changes are dropped; only true deltas are proposed.
- Writes are **all-or-none**: SQLite uses a real transaction; live MSX uses
  validate-all → apply → compensate. Optimistic concurrency re-reads `before` at apply time
  and reports a `conflict` (rolling back the whole set) if the record changed underneath.

## Routing

- `customer`-spoken signals may update customer-outcome narrative fields.
- `internal`-spoken competitive / risk / strategy signals route to internal fields
  (qualification comments, milestone risk details), never to customer-facing narrative.
