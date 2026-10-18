import { z } from 'zod'
import { readBoundedText } from '../common/http-response.js'

export const collaborationPolicySchema = z.object({
  contractVersion: z.literal('1.0'),
  revision: z.string().min(1).max(100),
  expiresAt: z.iso.datetime(),
  contexts: z.array(z.object({
    kind: z.enum(['channel', 'chat', 'meeting']),
    contextId: z.string().min(1).max(500),
    teamId: z.string().min(1).max(200).optional(),
    eligibleFteIds: z.array(z.string().min(1)).min(1).max(500),
    configurerIds: z.array(z.string().min(1)).max(500),
    publisherIds: z.array(z.string().min(1)).max(500)
  }).strict()).max(100)
}).strict()

const membersSchema = z.object({
  value: z.array(z.object({ userId: z.string().optional(), tenantId: z.string().optional() })),
  '@odata.nextLink': z.url().optional()
})

export class GraphContextAuthority {
  private readonly policy: z.infer<typeof collaborationPolicySchema>
  constructor(policy: unknown, private readonly getMetadataToken: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {
    this.policy = collaborationPolicySchema.parse(policy)
  }
  async verify(principal: { tenantId: string; userId: string; environmentId: string }, context: { kind: string; contextId: string }) {
    if (Date.parse(this.policy.expiresAt) <= Date.now()) throw new Error('The approved disclosure policy expired.')
    const policy = this.policy.contexts.find((entry) => entry.kind === context.kind && entry.contextId === context.contextId)
    if (!policy) throw new Error('No approved policy exists for this collaboration context.')
    if (policy.kind === 'channel' && !policy.teamId) throw new Error('The channel policy has no verified team identity.')
    const path = policy.kind === 'channel'
      ? `/teams/${encodeURIComponent(policy.teamId!)}/channels/${encodeURIComponent(policy.contextId)}/allMembers`
      : `/chats/${encodeURIComponent(policy.contextId)}/members`
    const expectedPath = `/v1.0${path}`
    let next: string | undefined = `https://graph.microsoft.com${expectedPath}`
    const members: z.infer<typeof membersSchema>['value'] = []
    let pages = 0
    while (next) {
      if (++pages > 20) throw new Error('The context membership request budget was exhausted.')
      const url = new URL(next)
      if (url.origin !== 'https://graph.microsoft.com' || url.pathname !== expectedPath || url.username || url.password || url.hash) {
        throw new Error('The context membership continuation is not trusted.')
      }
      const token = await this.getMetadataToken()
      if (!token) throw new Error('Resource-specific context authorization is unavailable.')
      const response = await this.fetcher(url, {
        redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
      })
      if (!response.ok) throw new Error('Current context membership could not be verified.')
      const page = membersSchema.parse(JSON.parse(await readBoundedText(response, 512_000)))
      members.push(...page.value)
      if (members.length > 500) throw new Error('The context membership limit was exceeded.')
      next = page['@odata.nextLink']
    }
    if (!members.some((member) => member.userId === principal.userId && member.tenantId === principal.tenantId)) {
      throw new Error('The caller is not a verified context member.')
    }
    return {
      revision: this.policy.revision,
      canConfigure: policy.configurerIds.includes(principal.userId),
      canPublish: policy.publisherIds.includes(principal.userId),
      audienceEligible: policy.kind !== 'meeting' && members.length > 0
        && members.every((member) => member.tenantId === principal.tenantId && member.userId !== undefined && policy.eligibleFteIds.includes(member.userId))
    }
  }
}
