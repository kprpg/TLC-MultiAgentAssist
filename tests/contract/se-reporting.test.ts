import { describe, expect, it } from 'vitest'
import { seReportingProfileSchema, seReportingRequestSchema } from '../../packages/common/contracts/se-reporting.js'

describe('SE reporting boundaries', () => {
    it('requires explicit confirmation for setup, run, review and publication', () => {
        for (const operation of ['setup', 'run', 'review', 'publish']) {
            expect(seReportingRequestSchema.safeParse({ contractVersion: '1.0', operation }).success).toBe(false)
        }
        expect(seReportingRequestSchema.parse({ contractVersion: '1.0', operation: 'get' })).toMatchObject({ operation: 'get' })
        expect(seReportingRequestSchema.safeParse({ contractVersion: '2.0', operation: 'get' }).success).toBe(false)
        expect(seReportingRequestSchema.safeParse({ contractVersion: '1.0', operation: 'get', token: 'not-allowed' }).success).toBe(false)
    })

    it('accepts explicit manager profiles without hardcoding a particular manager or ATU', () => {
        const profile = {
            id: 'my-manager', label: 'My reporting group',
            contractUrl: 'https://contoso.sharepoint.com/teams/reporting/Shared%20Documents/reporting-contract.md',
            outputRootUrl: 'https://contoso.sharepoint.com/teams/reporting/Shared%20Documents/Pod%20Reports',
            semanticModelId: '11111111-1111-4111-8111-111111111111',
            sources: ['m365_email']
        }
        expect(seReportingProfileSchema.parse(profile)).toEqual(profile)
        expect(seReportingProfileSchema.safeParse({ ...profile, contractUrl: 'http://localhost/private' }).success).toBe(false)
        expect(seReportingProfileSchema.safeParse({ ...profile, outputRootUrl: 'https://example.com/upload' }).success).toBe(false)
        expect(seReportingProfileSchema.safeParse({ ...profile, secret: 'never-store-tokens' }).success).toBe(false)
    })
})
