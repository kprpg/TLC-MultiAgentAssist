import { describe, expect, it, vi } from 'vitest'
import { LiveMsxConnector } from '../../packages/connectors/msx/live.js'

const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const template = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const g = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`

function fixture(handler: (url: URL) => unknown) {
    const transport = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input))
        const body = handler(url)
        if (body instanceof Response) return body
        return Response.json(body)
    })
    return { msx: new LiveMsxConnector({ getAccessToken: async () => 'private-token' }, transport), transport }
}

describe('LiveMsxConnector stage and pipeline read hooks', () => {
    it('reads a bounded entity set through the trusted base URL and follows server paging', async () => {
        const { msx, transport } = fixture((url) => url.searchParams.has('page')
            ? { value: [{ id: 'second' }] }
            : { value: [{ id: 'first' }], '@odata.nextLink': `${url.origin}${url.pathname}?page=2` })
        const rows = await msx.readRows('opportunities', { '$select': 'opportunityid', '$filter': 'statecode eq 0' })
        expect(rows).toEqual([{ id: 'first' }, { id: 'second' }])
        const first = new URL(String(transport.mock.calls[0]?.[0]))
        expect(first.pathname).toBe('/api/data/v9.2/opportunities')
        expect(first.searchParams.get('$filter')).toBe('statecode eq 0')
    })

    it('refuses to follow paging to a foreign origin', async () => {
        const { msx } = fixture(() => ({ value: [], '@odata.nextLink': 'https://evil.example.test/api/data/v9.2/opportunities?page=2' }))
        await expect(msx.readRows('opportunities', { '$select': 'opportunityid' })).rejects.toThrow()
    })

    it('rejects entity-set names that are not plain identifiers', async () => {
        const { msx, transport } = fixture(() => ({ value: [] }))
        await expect(msx.readRows('opportunities(1)/../accounts', {})).rejects.toThrow(/entity set/i)
        expect(transport).not.toHaveBeenCalled()
    })

    it('lists deal-team opportunity ids for any valid user id and de-duplicates them', async () => {
        const { msx, transport } = fixture(() => ({ value: [{ _msp_parentopportunityid_value: g('1') }, { _msp_parentopportunityid_value: g('1') }, { _msp_parentopportunityid_value: g('2') }, {}] }))
        await expect(msx.listDealTeamOpportunityIds(other)).resolves.toEqual([g('1'), g('2')])
        const url = new URL(String(transport.mock.calls[0]?.[0]))
        expect(url.pathname).toBe('/api/data/v9.2/msp_dealteams')
        expect(url.searchParams.get('$filter')).toBe(`statecode eq 0 and _msp_dealteamuserid_value eq ${other}`)
        await expect(msx.listDealTeamOpportunityIds('1) or (1 eq 1')).rejects.toThrow(/user id/i)
    })

    it('lists milestone-team opportunity ids for a user through the access-team template', async () => {
        const { msx, transport } = fixture((url) => {
            if (url.pathname.endsWith('/teamtemplates')) return { value: [{ teamtemplateid: template }] }
            if (url.pathname.endsWith('/teams')) return { value: [{ _regardingobjectid_value: g('3') }, { _regardingobjectid_value: g('4') }] }
            if (url.pathname.endsWith('/msp_engagementmilestones')) return { value: [{ msp_engagementmilestoneid: g('3'), _msp_opportunityid_value: g('7') }, { msp_engagementmilestoneid: g('4'), _msp_opportunityid_value: g('7') }] }
            throw new Error(`unexpected ${url.pathname}`)
        })
        await expect(msx.listMilestoneTeamOpportunityIds(me)).resolves.toEqual([g('7')])
        const teams = transport.mock.calls.map((call) => new URL(String(call[0]))).find((url) => url.pathname.endsWith('/teams'))
        expect(teams?.searchParams.get('$filter')).toContain(`_teamtemplateid_value eq ${template}`)
        expect(teams?.searchParams.get('$filter')).toContain(`member/systemuserid eq ${me}`)
    })

    it('returns no milestone-team opportunities when the access-team template is not configured', async () => {
        const { msx } = fixture((url) => url.pathname.endsWith('/teamtemplates') ? { value: [] } : { value: [] })
        await expect(msx.listMilestoneTeamOpportunityIds(me)).resolves.toEqual([])
    })

    it('surfaces HTTP status so callers can distinguish forbidden from unavailable', async () => {
        const { msx } = fixture(() => new Response('{}', { status: 403 }))
        await expect(msx.listDealTeamOpportunityIds(me)).rejects.toMatchObject({ status: 403 })
    })

    it('lists milestone ids on a user milestone teams for the SE reporting provider', async () => {
        const { msx } = fixture((url) => url.pathname.endsWith('/teamtemplates') ? { value: [{ teamtemplateid: template }] }
            : { value: [{ _regardingobjectid_value: g('3') }, { _regardingobjectid_value: g('3') }, { _regardingobjectid_value: g('4') }] })
        await expect(msx.listMilestoneTeamMilestoneIds(me)).resolves.toEqual([g('3'), g('4')])
        await expect(msx.listMilestoneTeamMilestoneIds('bad id')).rejects.toThrow(/user id/i)
    })
})