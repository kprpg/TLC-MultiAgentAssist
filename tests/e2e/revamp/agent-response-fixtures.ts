export const conversionOffer = 'Would you like me to convert this into a customer-ready email?'
export const briefOffer = 'If helpful, I can also prepare an executive brief.'
export const initialAgentResponse = `1. Summary

The approval path is unconfirmed. Keep the assessment read-only.

2. Observed signals

- Evidence: Sponsor confirmation is missing [O.C1].
- Confidence: Medium

3. Recommended actions

- Owner role: ATS
- Priority: High
- Rationale: Confirm the approval path before advancing.

4. Sources

[Review evidence](https://example.com/evidence)

5. Feedback prompt

${conversionOffer}`

export const followUpAgentResponse = `1. Customer-ready draft

**Subject:** Confirming the approval path

Please confirm the sponsor and approval sequence.

| Owner | Action | Evidence |
| --- | --- | --- |
| ATS | Confirm sponsor | O.C1 |

2. Assumptions and missing information

- Approval is unconfirmed. Human review is required before sending.

3. Feedback prompt

${briefOffer}`
