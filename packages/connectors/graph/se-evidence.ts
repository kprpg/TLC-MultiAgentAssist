import { z } from 'zod'
import { seEvidenceSchema, type SeEvidence } from '../../common/contracts/se-reporting.js'

const graphRoot = 'https://graph.microsoft.com/v1.0'
const privateContent = (value: string) => /salary|compensation|performance review|human resources|privileged legal|legal advice/i.test(value)
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface GraphPageReader {
    pages(path: string, maximum?: number): Promise<Record<string, unknown>[]>
}

export type EvidenceAccount = { accountId: string; accountName: string }

/** Account matching, text cleanup and window/privacy filtering shared by every Graph evidence source. */
export class SeEvidenceCollector {
    readonly output: SeEvidence[] = []
    constructor(
        private readonly accounts: readonly EvidenceAccount[],
        private readonly source: SeEvidence['source'],
        private readonly start: string,
        private readonly end: string
    ) { }

    matches(body: string): EvidenceAccount[] {
        return [...new Map(this.accounts.filter((row) =>
            new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(row.accountName)}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(body)
        ).map((row) => [row.accountId.toLowerCase(), row])).values()]
    }

    add(id: string, body: string, occurred: unknown, reference: string, qualifies = this.source !== 'm365_calendar'): void {
        const occurredOn = typeof occurred === 'string' && /^\d{4}-\d{2}-\d{2}/.test(occurred) ? occurred.slice(0, 10) : null
        if (!occurredOn || occurredOn < this.start || occurredOn > this.end || privateContent(body) || !isHttps(reference)) return
        const plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        for (const account of this.matches(plain)) {
            this.output.push(seEvidenceSchema.parse({
                id: `${this.source}:${id}:${account.accountId}`, accountId: account.accountId, source: this.source,
                date: occurredOn, summary: plain, reference, qualifies
            }))
        }
    }
}

function isHttps(value: string): boolean {
    try { return new URL(value).protocol === 'https:' } catch { return false }
}

const calendarEvent = z.object({
    id: z.string(), subject: z.string().nullable().optional(), bodyPreview: z.string().nullable().optional(),
    start: z.object({ dateTime: z.string() }), isCancelled: z.boolean().optional(), webLink: z.string()
})
const mailMessage = z.object({ id: z.string(), subject: z.string().nullable(), receivedDateTime: z.string(), body: z.object({ content: z.string() }), webLink: z.string() })
const chat = z.object({ id: z.string(), topic: z.string().nullable().optional() })
const chatMessage = z.object({ id: z.string(), createdDateTime: z.string(), body: z.object({ content: z.string() }) })

/**
 * Read-only Microsoft Graph evidence for SE reporting: calendar (context only), mail and Teams chats
 * (including meeting chats). Uses the signed-in user's delegated Calendars/Mail/Chat read grants.
 */
export class GraphSeEvidenceConnector {
    constructor(private readonly api: GraphPageReader, private readonly accounts: readonly EvidenceAccount[]) { }

    async read(source: SeEvidence['source'], start: string, end: string): Promise<SeEvidence[]> {
        const collector = new SeEvidenceCollector(this.accounts, source, start, end)
        const nextDay = new Date(`${end}T00:00:00Z`)
        nextDay.setUTCDate(nextDay.getUTCDate() + 1)
        if (source === 'm365_calendar') {
            const rows = await this.api.pages(`${graphRoot}/me/calendarView?startDateTime=${start}T00:00:00Z&endDateTime=${nextDay.toISOString()}&$select=id,subject,bodyPreview,start,isCancelled,webLink&$top=100`)
            for (const raw of rows) {
                const row = calendarEvent.parse(raw)
                if (row.isCancelled) continue
                collector.add(row.id, `${row.subject ?? ''}\n${row.bodyPreview ?? ''}`, row.start.dateTime, row.webLink)
            }
        } else if (source === 'm365_email') {
            const filter = encodeURIComponent(`receivedDateTime ge ${start}T00:00:00Z and receivedDateTime lt ${nextDay.toISOString()}`)
            const rows = await this.api.pages(`${graphRoot}/me/messages?$filter=${filter}&$select=id,subject,receivedDateTime,body,webLink&$expand=attachments($select=id,name,contentType,size)&$top=100`)
            for (const raw of rows) {
                const row = mailMessage.parse(raw)
                collector.add(row.id, `${row.subject ?? ''}\n${row.body.content}`, row.receivedDateTime, row.webLink)
            }
        } else if (source === 'm365_teams') {
            const chats = await this.api.pages(`${graphRoot}/me/chats?$select=id,topic,chatType&$top=50`, 20)
            for (const raw of chats) {
                const item = chat.parse(raw)
                const messages = await this.api.pages(`${graphRoot}/chats/${encodeURIComponent(item.id)}/messages?$top=50`, 200)
                for (const message of messages) {
                    const row = chatMessage.parse(message)
                    collector.add(row.id, `${item.topic ?? ''}\n${row.body.content}`, row.createdDateTime,
                        `https://teams.microsoft.com/l/chat/${encodeURIComponent(item.id)}/conversations?messageId=${encodeURIComponent(row.id)}`)
                }
            }
        } else {
            throw new Error(`The ${source} source is not supported by the Graph evidence connector.`)
        }
        return collector.output
    }
}
