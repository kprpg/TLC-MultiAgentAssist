import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { workingSessionTopicSchema } from '../../../packages/common/contracts/working-session.js'
import {
  confidenceLabel, draftFromTopic, groupFiles, prepareRequestFor, topicFromDraft, topicRequestFor, workingSessionFailure
} from '../../../apps/shared/working-session/working-session-model.js'
import { WorkingSessionLauncher } from '../../../apps/shared/working-session/working-session-launcher.js'

const opportunity = { id: 'opp-1', name: 'ARC ENABLED SQL', comments: 'x'.repeat(5000) }
const milestone = { id: 'ms-1', name: 'POC', comments: undefined }
const topic = workingSessionTopicSchema.parse({
  topic: 'Azure Arc-enabled SQL', domain: 'Hybrid', azureServices: ['Azure Arc', 'SQL MI'], deckQueries: ['arc sql'], learnQueries: ['sql mi arc', 'arc data'],
  iacScenario: 'Arc POC', confidence: 'high', basis: 'rules', evidence: ['ARC ENABLED SQL']
})

describe('working-session launcher model', () => {
  it('builds bounded, strict requests from opportunity and milestone text', () => {
    const request = topicRequestFor(opportunity, milestone)
    expect(request.opportunityComments).toHaveLength(4000)
    expect(request).not.toHaveProperty('milestoneComments')
    expect(request).toMatchObject({ contractVersion: '1.0', opportunityId: 'opp-1', milestoneId: 'ms-1', milestoneName: 'POC' })
    expect(topicRequestFor({ id: 'o', name: '   ' }, { id: 'm', name: '' })).toMatchObject({ opportunityName: 'Opportunity', milestoneName: 'Milestone' })
  })

  it('round-trips an editable draft and explains invalid edits', () => {
    const draft = draftFromTopic(topic)
    expect(draft.azureServices).toBe('Azure Arc, SQL MI')
    expect(draft.learnQueries).toBe('sql mi arc\narc data')
    expect(topicFromDraft(draft)).toEqual({ topic })
    expect(topicFromDraft({ ...draft, topic: '  ' })).toEqual({ error: 'Check Topic.' })
    expect(topicFromDraft({ ...draft, deckQueries: '\n\n' })).toEqual({ error: 'Check Deck searches (1 to 5 lines).' })
    expect(topicFromDraft({ ...draft, azureServices: Array.from({ length: 9 }, (_, index) => `s${index}`).join(',') })).toEqual({ error: 'Check Azure services (up to 8).' })
    expect(topicFromDraft({ ...draft, domain: '' })).toMatchObject({ topic: { domain: 'Azure platform' } })
  })

  it('builds the prepare request with the confirmed topic and chosen deliverables', () => {
    const request = prepareRequestFor(opportunity, milestone, topic, { decks: true, learn: false, iac: true })
    expect(request).toMatchObject({ opportunityName: 'ARC ENABLED SQL', milestoneName: 'POC', deliverables: { decks: true, learn: false, iac: true } })
  })

  it('strips transport prefixes from failures and groups files in a stable order', () => {
    expect(workingSessionFailure(new Error("Error invoking remote method 'tlc:working-session-prepare': Error: Learn is down"))).toBe('Learn is down')
    expect(workingSessionFailure(new Error(''))).toBe('The working session could not be prepared.')
    const file = (kind: 'deck' | 'learn' | 'iac' | 'manifest', path: string) => ({ path, kind, title: path, sourceLabel: 's', bytes: 1 })
    expect(groupFiles([file('manifest', 'manifest.json'), file('iac', 'iac/a'), file('deck', 'decks/a.pptx')]).map((group) => group.heading)).toEqual(['Decks', 'Deployment templates', 'About this folder'])
    expect(confidenceLabel({ confidence: 'low', basis: 'model' })).toBe('Suggested by the model - low confidence')
  })
})

describe('working-session launcher rendering', () => {
  const client = { deriveWorkingSessionTopic: async () => { throw new Error('unused') }, prepareWorkingSession: async () => { throw new Error('unused') } }
  it('renders only the launch button until it is opened, so no work starts on load', () => {
    const html = renderToStaticMarkup(createElement(WorkingSessionLauncher, { client, opportunity, milestones: [milestone] }))
    expect(html).toContain('>Working session<')
    expect(html).toContain('aria-label="Prepare working session"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('working-session-panel')
  })

  it('offers an icon-only button for narrow headers with the same accessible name', () => {
    const html = renderToStaticMarkup(createElement(WorkingSessionLauncher, { client, opportunity, milestones: [milestone], compact: true }))
    expect(html).toContain('working-session-compact')
    expect(html).toContain('<svg')
    expect(html).toContain('aria-label="Prepare working session"')
    expect(html).not.toContain('>Working session<')
  })
})
