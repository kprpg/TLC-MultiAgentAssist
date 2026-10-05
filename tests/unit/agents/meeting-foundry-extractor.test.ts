import { describe, expect, it, vi } from 'vitest'
import { createFoundryMeetingExtractor } from '../../../packages/agents/meeting-signal-extractor/src/foundry-extractor.js'
import type { MeetingExtractionContext } from '../../../packages/agents/meeting-signal-extractor/src/index.js'
import type { FoundryOpenAIClient } from '../../../packages/connectors/foundry/index.js'

function ctx(): MeetingExtractionContext {
    return {
        transcript: {
            id: 'tr-model', meetingType: 'customer', source: 'upload',
            segments: [
                { segmentId: 's1', speakerRole: 'customer', text: 'We have sign-off to spend 900 thousand this quarter.' },
                { segmentId: 's3', speakerRole: 'internal', text: 'We are up against AWS.' }
            ]
        },
        opportunity: { id: 'opp-1', name: 'Test opp', fields: { budgetAmount: null, budgetStatus: null, timeline: null, identifyCompetitors: false, qualificationComments: null } },
        milestones: []
    }
}

/** A fake Foundry OpenAI client returning a canned structured-outputs payload (no network). */
function fakeClient(payload: unknown): { client: FoundryOpenAIClient; create: ReturnType<typeof vi.fn> } {
    const create = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }))
    const client = { chat: { completions: { create } } } as unknown as FoundryOpenAIClient
    return { client, create }
}

describe('Foundry meeting extractor', () => {
    it('assembles a validated proposal from model signals with guardrails applied', async () => {
        const { client, create } = fakeClient({
            signals: [
                { field: 'budgetAmount', targetKind: 'opportunity', targetMilestoneId: null, value: 900000, confidence: 0.9, evidence: ['s1'], rationale: 'stated budget' },
                { field: 'budgetStatus', targetKind: 'opportunity', targetMilestoneId: null, value: 'Yes', confidence: 0.9, evidence: ['s1'], rationale: 'approved' },
                { field: 'identifyCompetitors', targetKind: 'opportunity', targetMilestoneId: null, value: true, confidence: 0.85, evidence: ['s3'], rationale: 'AWS' }
            ],
            newMilestones: [{ name: 'Proof of value', milestoneDate: null, commitment: null, confidence: 0.6, evidence: ['s3'] }],
            unmappedSignals: []
        })
        const extractor = createFoundryMeetingExtractor({ openAIClient: client, model: 'gpt-6.1-sol' })
        const proposal = await extractor(ctx(), { changeSetId: 'cs-model' })

        expect(create).toHaveBeenCalledTimes(1)
        const byField = new Map(proposal.slots.map((slot) => [slot.targetField, slot]))
        expect(byField.get('budgetAmount')?.after).toBe(900000)
        expect(byField.get('budgetStatus')?.after).toBe('Yes')
        expect(byField.get('identifyCompetitors')?.after).toBe(true)
        expect(proposal.newMilestones[0]?.name).toBe('Proof of value')
        for (const slot of proposal.slots) expect(slot.evidence.length).toBeGreaterThan(0)
    })

    it('drops model signals for fields outside the dictionary and no-ops', async () => {
        const { client } = fakeClient({
            signals: [
                { field: 'notARealField', targetKind: 'opportunity', targetMilestoneId: null, value: 'x', confidence: 0.9, evidence: ['s1'], rationale: 'bogus' },
                { field: 'identifyCompetitors', targetKind: 'opportunity', targetMilestoneId: null, value: false, confidence: 0.9, evidence: ['s1'], rationale: 'no-op' }
            ],
            newMilestones: [],
            unmappedSignals: []
        })
        const extractor = createFoundryMeetingExtractor({ openAIClient: client, model: 'gpt-6.1-sol' })
        const proposal = await extractor(ctx(), { changeSetId: 'cs-model-2' })
        expect(proposal.slots).toHaveLength(0)
    })

    it('throws when the model returns no content', async () => {
        const create = vi.fn(async () => ({ choices: [{ message: { content: '' } }] }))
        const client = { chat: { completions: { create } } } as unknown as FoundryOpenAIClient
        const extractor = createFoundryMeetingExtractor({ openAIClient: client, model: 'gpt-6.1-sol' })
        await expect(extractor(ctx(), { changeSetId: 'cs-model-3' })).rejects.toThrow(/no content/)
    })
})
