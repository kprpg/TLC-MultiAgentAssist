# Meeting Signal Extractor

Reads a customer or internal meeting transcript and proposes MCEM-aligned field updates for
the anchored opportunity and its milestones. Output is a strict, reviewable change-set
proposal; a human toggles and approves it before anything is written. The agent never writes.

## Inputs

- A diarized transcript (`MeetingTranscript`) — from Microsoft Graph (Teams), or an uploaded /
  pasted recording transcript parsed by `parseTranscriptContent` (WebVTT or `Speaker: text`).
- A snapshot of the anchored opportunity and its milestones (current field values).
- The canonical field dictionary (`MEETING_FIELD_DICTIONARY`) listing allowed fields,
  value types, MCEM criteria, option labels, and sensitivity.

## Outputs

A `MeetingChangeSetProposal`: per-field `slots` (target, before/after, confidence, MCEM
criterion, evidence segment ids, sensitive/blocked flags), `newMilestones`, pre-selected
`suggestedMilestoneIds`, and `unmappedSignals`. Every slot cites transcript evidence.

## Model

Production: **`gpt-6.1-sol`** (newest GPT-6 reasoning deployment in the `multiagentacctteam`
Foundry project) with Structured Outputs (`json_schema`), authenticated with Azure CLI. The
implemented engine is `createFoundryMeetingExtractor` in [`src/foundry-extractor.ts`](src/foundry-extractor.ts):
it sends the transcript + opportunity/milestone snapshot to the model, which returns *signals*
only; the shared `assembleProposal` in [`src/index.ts`](src/index.ts) then builds the validated
change set. Value tier: `gpt-4.1`. Retrieval (future): `text-embedding-3-large`. The offline /
SQLite path uses the deterministic `extractMeetingSignals`, which obeys the same guardrails so the
slice can be developed and tested without a model call. Select the engine with the
`tlc.meetingExtractor` setting or `TLC_MEETING_EXTRACTOR` env var.

## Dependencies

Common contracts only. The transcript is untrusted input; the agent has no tools and performs
no writes. The orchestrator validates output against `meetingChangeSetProposalSchema` and
discards any slot that lacks evidence or targets a field outside the dictionary.

## Failure Behavior

Emits low-confidence slots (never pre-checked) rather than omitting real signals; drops no-op
changes; never fabricates values, dates, stakeholders, or competitors; routes internal
competitive/risk talk to internal fields, never to customer-facing narrative.

## Owner

Meeting Capture capability owner.
