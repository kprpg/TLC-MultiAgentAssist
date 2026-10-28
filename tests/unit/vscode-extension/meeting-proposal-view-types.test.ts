import { describe, expect, expectTypeOf, it } from 'vitest'
import {
    meetingChangeSetProposalSchema,
    type MeetingChangeSetProposal
} from '../../../packages/common/contracts/meeting.js'
import type { MeetingChangeSetProposalView } from '../../../apps/vscode-extension/src/webview/view-types.js'

describe('meeting proposal view types', () => {
    it.each([
        {},
        { contractVersion: undefined, inference: undefined },
        {
            contractVersion: '1.3',
            inference: {
                contractVersion: '1.0',
                correlationId: '00000000-0000-4000-8000-000000000001',
                requested: 'sample',
                provider: 'sample',
                state: 'complete'
            }
        }
    ])('accepts contract proposals with optional metadata %j', (metadata) => {
        expectTypeOf<MeetingChangeSetProposal>().toMatchTypeOf<MeetingChangeSetProposalView>()

        const proposal = meetingChangeSetProposalSchema.parse({
            ...metadata,
            changeSetId: 'changes-1',
            transcriptId: 'transcript-1',
            opportunityId: 'opportunity-1',
            meetingType: 'customer',
            slots: [{
                slotId: 'slot-1',
                label: 'Meeting notes',
                mcemCriterion: 'notes',
                targetKind: 'opportunity',
                targetRecordId: undefined,
                targetField: 'description',
                valueType: 'text',
                after: 'Confirm the next review.',
                displayBefore: undefined,
                displayAfter: 'Confirm the next review.',
                confidence: 0.9,
                checkedByDefault: true,
                blocked: false,
                blockedReason: undefined,
                sensitive: false,
                rationale: 'Explicit next step.',
                evidence: ['segment-1']
            }],
            newMilestones: [{
                tempId: 'milestone-1',
                name: 'Next review',
                milestoneDate: undefined,
                ownerName: undefined,
                commitment: undefined,
                confidence: 0.9,
                checkedByDefault: false,
                evidence: ['segment-1']
            }],
            suggestedMilestoneIds: [],
            unmappedSignals: [],
            proposedAt: '2026-01-01T00:00:00.000Z'
        })
        const view: MeetingChangeSetProposalView = proposal

        expect(view).toBe(proposal)
        expect(view.slots[0]?.displayBefore).toBeUndefined()
        expect(view.newMilestones[0]?.commitment).toBeUndefined()
    })
})
