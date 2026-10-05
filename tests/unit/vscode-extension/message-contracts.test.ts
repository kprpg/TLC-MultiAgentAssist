import { describe, expect, it } from 'vitest'
import {
    bridgeMethodSchema,
    errorResponse,
    parseBridgeParams,
    requestEnvelopeSchema,
    responseEnvelopeSchema,
    successResponse
} from '../../../apps/vscode-extension/src/message-contracts.js'

describe('vscode-extension message contracts', () => {
    it('accepts a well-formed request envelope', () => {
        const parsed = requestEnvelopeSchema.parse({ kind: 'request', id: 'req-1', method: 'listAccounts' })
        expect(parsed.method).toBe('listAccounts')
    })

    it('rejects an unknown method', () => {
        expect(() => bridgeMethodSchema.parse('deleteEverything')).toThrow()
    })

    it('rejects unknown keys on the request envelope', () => {
        expect(() => requestEnvelopeSchema.parse({ kind: 'request', id: 'r', method: 'listAccounts', extra: true })).toThrow()
    })

    it('rejects an oversized message id', () => {
        expect(() => requestEnvelopeSchema.parse({ kind: 'request', id: 'x'.repeat(201), method: 'listAccounts' })).toThrow()
    })

    it('validates method-specific params and strips nothing', () => {
        const params = parseBridgeParams('listOpportunities', { accountId: 'account-contoso' })
        expect(params.accountId).toBe('account-contoso')
    })

    it('rejects params with unexpected fields', () => {
        expect(() => parseBridgeParams('listOpportunities', { accountId: 'a', hack: 1 })).toThrow()
    })

    it('validates account curation and Deal Team removal messages', () => {
        expect(parseBridgeParams('listAccounts', { includeHidden: true })).toEqual({ includeHidden: true })
        expect(parseBridgeParams('searchAccounts', { query: 'Northwind', matchBy: 'name' })).toEqual({ query: 'Northwind', matchBy: 'name' })
        expect(parseBridgeParams('addAccount', { accountId: 'account-northwind' })).toEqual({ accountId: 'account-northwind' })
        expect(parseBridgeParams('setAccountVisibility', { accountId: 'account-northwind', visibility: 'hidden' })).toEqual({ accountId: 'account-northwind', visibility: 'hidden' })
        expect(parseBridgeParams('leaveDealTeam', { opportunityId: 'opportunity-1' })).toEqual({ opportunityId: 'opportunity-1' })
    })

    it('rejects an evidence url that is not a url', () => {
        expect(() => parseBridgeParams('openEvidence', { url: 'not a url' })).toThrow()
    })

    it('accepts the meeting-capture methods and their params', () => {
        expect(bridgeMethodSchema.parse('listMeetingTranscripts')).toBe('listMeetingTranscripts')
        expect(parseBridgeParams('getMeetingTranscript', { transcriptId: 'tr-grid-customer' })).toEqual({ transcriptId: 'tr-grid-customer' })
        expect(parseBridgeParams('proposeMeetingChangeSet', { opportunityId: 'opp-1', transcriptId: 'tr-1' })).toMatchObject({ opportunityId: 'opp-1' })
        expect(parseBridgeParams('proposeMeetingChangeSet', { opportunityId: 'opp-1', rawTranscript: { content: 'Priya: hi', meetingType: 'customer' } }).rawTranscript?.content).toBe('Priya: hi')
    })

    it('rejects a meeting approval whose reason is too short', () => {
        const proposal = {
            changeSetId: 'cs-1', transcriptId: 'tr-1', opportunityId: 'opp-1', meetingType: 'customer',
            slots: [], newMilestones: [], suggestedMilestoneIds: [], unmappedSignals: [], proposedAt: new Date().toISOString()
        }
        expect(() => parseBridgeParams('applyMeetingChangeSet', {
            proposal,
            approval: { changeSetId: 'cs-1', opportunityId: 'opp-1', approvedSlotIds: [], approvedNewMilestoneTempIds: [], selectedMilestoneIds: [], reason: 'x' }
        })).toThrow()
    })

    it('builds discriminated success and error responses', () => {
        expect(responseEnvelopeSchema.parse(successResponse('req-1', { ok: true }))).toMatchObject({ ok: true })
        expect(responseEnvelopeSchema.parse(errorResponse('req-1', 'nope', 'code'))).toMatchObject({ ok: false, error: { code: 'code' } })
    })
})
