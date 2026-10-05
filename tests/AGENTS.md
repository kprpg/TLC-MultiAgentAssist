# AGENTS.md — Tests & fixtures

Inherits the root AGENTS.md. Runner = **vitest** (`npm test`; prefer the smallest relevant files);
UI e2e = Playwright (`npm run test:smoke:*`).

## Rules
- **Contract tests** (`tests/contract`) guard the zod wire contracts — update them whenever a
  `packages/common` contract changes, and bump `contractVersion` for wire-shape changes.
- **One canonical sample dataset** is the source of truth — never fork per-surface copies. Target: a git
  JSON seed loaded into a host-side **SQLite** local store behind the existing `MsxConnector` seam
  (`TLC_DATA_MODE = live | sample | local`); see `docs/MeetingCapture.md` §G. Every record is parsed
  through the `packages/common` zod schemas and mirrors the MSX/Dataverse field shape.
- **Meeting-extract fixtures**: pair each transcript (diarized, timestamped segments) with a
  **golden-expectation** set, and cover each Part E guardrail scenario (no-op, conflict, low-confidence,
  blocked-owner, customer-vs-internal, additive-comment).
- Keep all fixtures **deterministic and sanitized** — no real customer data.
