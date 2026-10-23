import { describe, expect, it, vi } from 'vitest'
import { parseSeLiveContract } from '../../../packages/connectors/se-reporting/contract.js'
import { SeReportingApi } from '../../../packages/connectors/se-reporting/live.js'

const contract = `Schema version: \`2.0\`
\`\`\`yaml
manager:
  manager_system_user_id: "manager-one"
  manager_alias: "manager-alias"
  display_name: "Sample Manager"
\`\`\`
### ATUs
- atu-one
- atu-two
### Pillars
- infra
### Account Eligibility and Assignment Scope
### Scorecard
Committed On and actualend govern dates.
### Customer Updates
### Asks for Manager
### Dashboard Sections
See more
`
describe('SE reporting source boundaries', () => {
    it('reads the selected manager and scope from a valid v2 contract, never from a bundled default', () => {
        const result = parseSeLiveContract(contract, 'https://example.sharepoint.com/reporting-contract.md')
        expect(result.manager).toEqual({ name: 'Sample Manager', alias: 'manager-alias', system_user_id: 'manager-one' })
        expect(result.allowedAtus).toEqual(['atu-one', 'atu-two'])
        expect(result.allowedPillars).toEqual(['infra'])
        expect(result.hash).toHaveLength(64)
        expect(() => parseSeLiveContract(contract.replace('2.0', '1.2'), 'local-test', true)).toThrow(/v2.0/)
        expect(() => parseSeLiveContract(contract.replace('manager-one', '<placeholder>'), 'local-test', true)).toThrow(/placeholder|selector/i)
        expect(parseSeLiveContract(contract, 'explicit-local-test.md', true).testMode).toBe(true)
    })

    it('rejects cross-origin continuations before sending delegated credentials', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ value: [], '@odata.nextLink': 'https://example.invalid/steal' })))
        const api = new SeReportingApi({ getToken: async () => 'synthetic-token', expectedEmail: async () => 'sample@example.test', fetcher })
        await expect(api.pages('https://graph.microsoft.com/v1.0/me/messages?$top=1')).rejects.toThrow(/pagination/i)
        expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('does not treat semantic-model error/truncation payloads as successful source reads', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ error: { message: 'truncated' }, tables: [{ rows: [] }] }] })))
        const api = new SeReportingApi({ getToken: async () => 'synthetic-token', expectedEmail: async () => 'sample@example.test', fetcher })
        await expect(api.query('11111111-1111-4111-8111-111111111111', 'EVALUATE ROW("n",1)')).rejects.toThrow(/failed|budget/i)
    })

    it('does not follow a private-file redirect or forward a bearer token to another host', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://other.sharepoint.com/private' } }))
        const api = new SeReportingApi({ getToken: async () => 'synthetic-token', expectedEmail: async () => 'sample@example.test', fetcher })
        await expect(api.file('drive-one', 'file-one', 'example.sharepoint.com')).rejects.toThrow(/redirected/i)
        expect(fetcher).toHaveBeenCalledTimes(1)
    })
})
