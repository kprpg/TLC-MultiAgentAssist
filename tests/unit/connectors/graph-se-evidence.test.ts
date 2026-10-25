import { describe, expect, it, vi } from 'vitest'
import { GraphSeEvidenceConnector, SeEvidenceCollector, type GraphPageReader } from '../../../packages/connectors/graph/se-evidence.js'
import { seEvidenceSchema } from '../../../packages/common/contracts/se-reporting.js'

const accounts = [
    { accountId: 'acct-1', accountName: 'Contoso Energy' },
    { accountId: 'acct-2', accountName: 'Fabrikam Health' }
]

function reader(responses: Record<string, Record<string, unknown>[]>) {
    const pages = vi.fn(async (path: string) => {
        const key = Object.keys(responses).find((prefix) => path.includes(prefix))
        if (!key) throw new Error(`unexpected ${path}`)
        return responses[key]!
    })
    return { api: { pages } satisfies GraphPageReader, pages }
}

describe('SeEvidenceCollector', () => {
    it('matches only whole account names, strips markup and drops private or out-of-window content', () => {
        const collector = new SeEvidenceCollector(accounts, 'm365_email', '2026-10-01', '2026-10-31')
        collector.add('a', '<p>Contoso Energy   confirmed the plan</p>', '2026-10-10T12:00:00Z', 'https://outlook.office.com/mail/a')
        collector.add('b', 'Contosoft is unrelated', '2026-10-10T12:00:00Z', 'https://outlook.office.com/mail/b')
        collector.add('c', 'Contoso Energy compensation review', '2026-10-10T12:00:00Z', 'https://outlook.office.com/mail/c')
        collector.add('d', 'Contoso Energy late', '2026-11-02T12:00:00Z', 'https://outlook.office.com/mail/d')
        collector.add('e', 'Contoso Energy and Fabrikam Health workshop', '2026-10-11T12:00:00Z', 'https://outlook.office.com/mail/e')
        expect(collector.output.map((row) => row.id)).toEqual(['m365_email:a:acct-1', 'm365_email:e:acct-1', 'm365_email:e:acct-2'])
        expect(collector.output[0]?.summary).toBe('Contoso Energy confirmed the plan')
        for (const row of collector.output) expect(seEvidenceSchema.safeParse(row).success).toBe(true)
    })

    it('skips records with non-HTTPS references rather than failing the whole run', () => {
        const collector = new SeEvidenceCollector(accounts, 'm365_email', '2026-10-01', '2026-10-31')
        collector.add('a', 'Contoso Energy plan', '2026-10-10T12:00:00Z', 'http://insecure.example.test/a')
        expect(collector.output).toEqual([])
    })
})

describe('GraphSeEvidenceConnector calendar', () => {
    it('turns matching meetings into non-qualifying context evidence', async () => {
        const { api, pages } = reader({
            '/me/calendarView': [
                { id: 'e1', subject: 'Contoso Energy architecture review', bodyPreview: 'Agenda', start: { dateTime: '2026-10-12T15:00:00.0000000', timeZone: 'UTC' }, isCancelled: false, webLink: 'https://outlook.office.com/calendar/item/e1' },
                { id: 'e2', subject: 'Fabrikam Health sync', bodyPreview: '', start: { dateTime: '2026-10-13T15:00:00.0000000', timeZone: 'UTC' }, isCancelled: true, webLink: 'https://outlook.office.com/calendar/item/e2' },
                { id: 'e3', subject: 'Team lunch', bodyPreview: 'No customer', start: { dateTime: '2026-10-14T12:00:00.0000000', timeZone: 'UTC' }, isCancelled: false, webLink: 'https://outlook.office.com/calendar/item/e3' },
                { id: 'e4', subject: 'Fabrikam Health compensation review', bodyPreview: '', start: { dateTime: '2026-10-15T12:00:00.0000000', timeZone: 'UTC' }, isCancelled: false, webLink: 'https://outlook.office.com/calendar/item/e4' },
                { id: 'e5', subject: 'Review', bodyPreview: 'Fabrikam Health follow-up', start: { dateTime: '2026-10-16T12:00:00.0000000', timeZone: 'UTC' }, isCancelled: false, webLink: 'https://outlook.office.com/calendar/item/e5' }
            ]
        })
        const evidence = await new GraphSeEvidenceConnector(api, accounts).read('m365_calendar', '2026-10-01', '2026-10-31')
        expect(evidence.map((row) => [row.id, row.accountId, row.qualifies, row.date])).toEqual([
            ['m365_calendar:e1:acct-1', 'acct-1', false, '2026-10-12'],
            ['m365_calendar:e5:acct-2', 'acct-2', false, '2026-10-16']
        ])
        const path = String(pages.mock.calls[0]?.[0])
        expect(path).toContain('startDateTime=2026-10-01T00:00:00Z')
        expect(path).toContain('endDateTime=2026-11-01T00:00:00.000Z')
        expect(path).toContain('bodyPreview')
    })
})

describe('GraphSeEvidenceConnector mail and Teams', () => {
    it('keeps mail as qualifying evidence and filters by the reporting window', async () => {
        const { api, pages } = reader({
            '/me/messages': [{ id: 'm1', subject: 'Contoso Energy recap', receivedDateTime: '2026-10-10T12:00:00Z', body: { content: 'Production readiness confirmed.' }, webLink: 'https://outlook.office.com/mail/m1' }]
        })
        const evidence = await new GraphSeEvidenceConnector(api, accounts).read('m365_email', '2026-10-01', '2026-10-31')
        expect(evidence).toHaveLength(1)
        expect(evidence[0]).toMatchObject({ accountId: 'acct-1', qualifies: true, source: 'm365_email' })
        expect(decodeURIComponent(String(pages.mock.calls[0]?.[0]))).toContain('receivedDateTime ge 2026-10-01T00:00:00Z and receivedDateTime lt 2026-11-01T00:00:00.000Z')
    })

    it('reads Teams chats including meeting chats and uses the chat topic for matching', async () => {
        const { api, pages } = reader({
            '/me/chats?': [{ id: 'chat-1', topic: 'Contoso Energy migration', chatType: 'meeting' }, { id: 'chat-2', topic: null, chatType: 'oneOnOne' }],
            '/chats/chat-1/messages': [{ id: 'msg-1', createdDateTime: '2026-10-09T09:00:00Z', body: { content: 'Recap: cutover is scheduled.' } }],
            '/chats/chat-2/messages': [{ id: 'msg-2', createdDateTime: '2026-10-09T10:00:00Z', body: { content: 'Fabrikam Health asked about quota.' } }]
        })
        const evidence = await new GraphSeEvidenceConnector(api, accounts).read('m365_teams', '2026-10-01', '2026-10-31')
        expect(evidence.map((row) => [row.id, row.accountId, row.qualifies])).toEqual([
            ['m365_teams:msg-1:acct-1', 'acct-1', true], ['m365_teams:msg-2:acct-2', 'acct-2', true]
        ])
        expect(evidence[0]?.reference).toBe('https://teams.microsoft.com/l/chat/chat-1/conversations?messageId=msg-1')
        expect(pages.mock.calls.some(([path]) => String(path).includes('/chats/chat-1/messages'))).toBe(true)
    })

    it('propagates source budget failures so truncated data is never reported as complete', async () => {
        const api: GraphPageReader = { pages: async () => { throw Object.assign(new Error('limit'), { code: 'reporting-source-limit' }) } }
        await expect(new GraphSeEvidenceConnector(api, accounts).read('m365_email', '2026-10-01', '2026-10-31')).rejects.toMatchObject({ code: 'reporting-source-limit' })
    })

    it('rejects sources it does not own', async () => {
        await expect(new GraphSeEvidenceConnector({ pages: async () => [] }, accounts).read('wiki', '2026-10-01', '2026-10-31')).rejects.toThrow(/not supported/i)
    })
})
