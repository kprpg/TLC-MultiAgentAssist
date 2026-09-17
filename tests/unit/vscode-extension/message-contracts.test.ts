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

    it('rejects an evidence url that is not a url', () => {
        expect(() => parseBridgeParams('openEvidence', { url: 'not a url' })).toThrow()
    })

    it('builds discriminated success and error responses', () => {
        expect(responseEnvelopeSchema.parse(successResponse('req-1', { ok: true }))).toMatchObject({ ok: true })
        expect(responseEnvelopeSchema.parse(errorResponse('req-1', 'nope', 'code'))).toMatchObject({ ok: false, error: { code: 'code' } })
    })
})
