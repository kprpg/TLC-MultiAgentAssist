import { beforeAll, describe, expect, it } from 'vitest'
import { contractVersion } from '../../packages/common/contracts/version.js'
import { agentTaskResponseSchema } from '../../packages/common/contracts/index.js'
import { meetingChangeSetProposalSchema } from '../../packages/common/contracts/meeting.js'
import { workingSessionResultSchema, workingSessionTopicResponseSchema } from '../../packages/common/contracts/working-session.js'
import { seReportingResponseSchema } from '../../packages/common/contracts/se-reporting.js'

const enabled = process.env['TLC_RUN_LIVE_SMOKE'] === '1' && Boolean(process.env['TLC_SAMPLE_LIVE_URL'])
describe.skipIf(!enabled)('explicitly authorized hosted sample Foundry smoke (incurs charges)', () => {
  const base = process.env['TLC_SAMPLE_LIVE_URL'] || 'https://not-configured.invalid'
  async function request(path: string, body?: unknown) {
    const url = new URL(path, base)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use the HTTPS sample-slot URL without credentials.')
    const response = await fetch(url, {
      redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(120_000),
      ...(body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(body)
      })
    })
    expect(response.status).toBe(200)
    return response
  }
  beforeAll(async () => {
    const html = await (await request('/')).text()
    expect(html).toContain('<meta name="tlc-data-mode" content="sample" />')
    expect(html).toContain('<meta name="tlc-ai-mode" content="foundry" />')
    expect(await (await request('/api/me')).json()).toMatchObject({ email: 'sample.user@example.com' })
  }, 150_000)

  it.each(['account-pulse', 'mcem-coach', 'pursuit-executive', 'risk-solution-play'])('uses real %s inference, not fallback', async (capability) => {
    const result = agentTaskResponseSchema.parse(await (await request('/api/agent-task', {
      contractVersion, capability, accountId: 'account-contoso', opportunityId: 'opp-grid-modernization',
      prompt: 'Summarize the supplied synthetic sample evidence only. Do not call tools.'
    })).json())
    expect(result).toMatchObject({ mode: 'sample', inference: { provider: 'foundry', state: 'complete' } })
  }, 150_000)

  it('uses real structured inference for sample meetings, topics/templates and reporting', async () => {
    const meeting = meetingChangeSetProposalSchema.parse(await (await request(
      '/api/opportunities/opp-grid-modernization/meeting-change-set', { transcriptId: 'tr-grid-customer' })).json())
    expect(meeting.inference).toMatchObject({ provider: 'foundry', state: 'complete' })
    const topic = workingSessionTopicResponseSchema.parse(await (await request('/api/working-session/topic', {
      contractVersion: '1.0', opportunityId: 'opp-grid-modernization',
      opportunityName: 'Grid operations modernization', milestoneName: 'Sample storage pilot'
    })).json())
    expect(topic).toMatchObject({ mode: 'sample', inference: { provider: 'foundry', state: 'complete' } })
    const pack = workingSessionResultSchema.parse(await (await request('/api/working-session/prepare', {
      contractVersion: '1.0', opportunityId: 'opp-grid-modernization', opportunityName: 'Grid operations modernization',
      milestoneName: 'Sample storage pilot', topic: topic.topic, deliverables: { learn: false, decks: false, iac: true }
    })).json())
    expect(pack).toMatchObject({ mode: 'sample', inference: { provider: 'foundry', state: 'complete' } })
    const report = seReportingResponseSchema.parse(await (await request('/api/se-reporting', {
      contractVersion: '1.0', operation: 'run', profileId: 'sample-manager', period: '2026-10',
      pillar: 'infra', allowUnavailable: [], confirmed: true
    })).json())
    expect(report).toMatchObject({ kind: 'state', mode: 'sample', inference: { provider: 'foundry', state: 'complete' } })
  }, 510_000)
})
