import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../../packages/connectors/msx/live.js'
import { hlsVerticalValues } from '../../../packages/connectors/msx/customer-industry.js'

const health = '11111111-1111-4111-8111-111111111111'
const retail = '22222222-2222-4222-8222-222222222222'
const unknown = '33333333-3333-4333-8333-333333333333'
const outside = '44444444-4444-4444-8444-444444444444'
const choices = [
    { value: 10, label: 'Health Payor' }, { value: 11, label: 'Health Pharma' },
    { value: 12, label: 'Health Provider' }, { value: 13, label: 'MedTech' },
    { value: 90, label: 'Retailers' }, { value: 91, label: 'Health & Personal Care' }
]

describe('authoritative HLS customer classification', () => {
    it('resolves all four HLS verticals from metadata, not hard-coded option values or company names', () => {
        expect([...hlsVerticalValues(choices)]).toEqual([10, 11, 12, 13])
        expect([...hlsVerticalValues(choices.map((choice) => ({ ...choice, value: choice.value + 100 })))]).toEqual([110, 111, 112, 113])
    })
    it.each([
        choices.filter((choice) => choice.label !== 'MedTech'),
        [...choices, { value: 14, label: 'Health Provider' }],
        choices.map((choice) => choice.label === 'MedTech' ? { ...choice, value: Number.NaN } : choice)
    ].map((input) => ({ input })))('fails closed for missing, ambiguous or invalid HLS metadata', ({ input }) => {
        expect(() => hlsVerticalValues(input)).toThrow(/HLS/i)
    })
    function setup(failMetadata = false) {
        const fetcher = vi.fn<typeof fetch>(async (input) => {
            const url = new URL(String(input))
            if (url.pathname.includes('PicklistAttributeMetadata')) {
                if (failMetadata) return new Response('{}', { status: 403 })
                return Response.json({ OptionSet: { Options: choices.map((choice) => ({
                    Value: choice.value, Label: { LocalizedLabels: [{ LanguageCode: 1033, Label: choice.label }] }
                })) } })
            }
            if (url.pathname.endsWith('/accounts')) return Response.json({ value: [
                { accountid: health, name: 'Synthetic neutral account', msp_verticalcode: 12 },
                { accountid: retail, name: 'Synthetic Health Retail Supplies', msp_verticalcode: 90 },
                { accountid: unknown, name: 'Synthetic Medical Label', msp_verticalcode: null },
                { accountid: outside, msp_verticalcode: 12 }
            ] })
            throw new Error('Unexpected HLS source request.')
        })
        return { fetcher, source: new LiveMsxConnector({ getAccessToken: async () => 'synthetic' }, fetcher) }
    }
    it('returns only verified HLS IDs from the already-authorized candidate set', async () => {
        const { source, fetcher } = setup()
        expect(await source.getHlsAccountIds([health, retail, unknown])).toEqual([health])
        const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)))
        expect(urls[0]!.pathname).toContain("Attributes(LogicalName='msp_verticalcode')")
        const accountQuery = urls.find((url) => url.pathname.endsWith('/accounts'))!
        expect(accountQuery.searchParams.get('$select')).toBe('accountid,msp_verticalcode')
        expect(accountQuery.searchParams.get('$filter')).toContain(`accountid eq ${health}`)
        expect(accountQuery.searchParams.get('$filter')).toContain('msp_verticalcode eq 12')
        expect(accountQuery.searchParams.get('$filter')).not.toContain(outside)
    })
    it('does not request the unused generic Industry field or read every account', async () => {
        const { source, fetcher } = setup()
        await source.getHlsAccountIds([health])
        for (const [url] of fetcher.mock.calls) expect(String(url)).not.toContain("LogicalName='industrycode'")
        expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/accounts?'))).toHaveLength(1)
    })
    it('does not downgrade failed classification to an unfiltered customer list', async () => {
        const { source, fetcher } = setup(true)
        await expect(source.getHlsAccountIds([health, retail])).rejects.toThrow()
        expect(fetcher).toHaveBeenCalledTimes(1)
    })
    it('requires canonical IDs and performs no read for an empty authorized portfolio', async () => {
        const { source, fetcher } = setup()
        expect(await source.getHlsAccountIds([])).toEqual([])
        await expect(source.getHlsAccountIds(['not-a-guid'])).rejects.toThrow()
        expect(fetcher).not.toHaveBeenCalled()
    })
})
