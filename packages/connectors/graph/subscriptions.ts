import { z } from 'zod'
import { readBoundedText } from '../common/http-response.js'

const subscriptionSchema = z.object({ id: z.uuid(), expirationDateTime: z.iso.datetime() })
export class GraphSubscriptionConnector {
  constructor(private readonly origin: string, private readonly getToken: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Graph notifications require an exact HTTPS callback origin.')
  }
  async create(meetingId: string, clientState: string) {
    if (!meetingId || /[/:\\?#\r\n]/.test(meetingId)) throw new Error('A verified Graph meeting identity is required.')
    return this.request('POST', '/subscriptions', {
      changeType: 'created',
      notificationUrl: `${this.origin}/api/teams/graph/notifications`,
      lifecycleNotificationUrl: `${this.origin}/api/teams/graph/notifications`,
      resource: `communications/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
      includeResourceData: false,
      expirationDateTime: new Date(Date.now() + 50 * 60_000).toISOString(),
      clientState
    })
  }
  async renew(subscriptionId: string) {
    return this.request('PATCH', `/subscriptions/${z.uuid().parse(subscriptionId)}`, { expirationDateTime: new Date(Date.now() + 50 * 60_000).toISOString() })
  }
  async stop(subscriptionId: string): Promise<void> {
    const token = await this.getToken()
    const response = await this.fetcher(`https://graph.microsoft.com/v1.0/subscriptions/${z.uuid().parse(subscriptionId)}`, {
      method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${token}` }
    })
    if (!response.ok && response.status !== 404) throw new Error('Subscription cleanup is unconfirmed.')
  }
  private async request(method: string, path: string, body: unknown) {
    const token = await this.getToken()
    if (!token) throw new Error('Current delegated Graph authorization is required for subscription changes.')
    const response = await this.fetcher(`https://graph.microsoft.com/v1.0${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error('Graph transcript notifications are unavailable under the current permission or tenant policy.')
    return subscriptionSchema.parse(JSON.parse(await readBoundedText(response, 64_000)))
  }
}
