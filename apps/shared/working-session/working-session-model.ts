import {
  workingSessionContractVersion, workingSessionTopicSchema,
  type WorkingSessionDeliverables, type WorkingSessionFile, type WorkingSessionPrepareRequest, type WorkingSessionTopic, type WorkingSessionTopicRequest
} from '../../../packages/common/contracts/working-session.js'

/** Structural, so every surface's own opportunity and milestone view types fit. */
export interface WorkingSessionOpportunity { id: string; name: string; comments?: string | undefined }
export interface WorkingSessionMilestone { id: string; name: string; comments?: string | undefined }

const clip = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max)

export function topicRequestFor(opportunity: WorkingSessionOpportunity, milestone: WorkingSessionMilestone): WorkingSessionTopicRequest {
  const opportunityComments = clip(opportunity.comments, 4000)
  const milestoneComments = clip(milestone.comments, 4000)
  return {
    contractVersion: workingSessionContractVersion, opportunityId: clip(opportunity.id, 200),
    opportunityName: clip(opportunity.name, 300) || 'Opportunity', milestoneId: clip(milestone.id, 200),
    milestoneName: clip(milestone.name, 300) || 'Milestone',
    ...(opportunityComments ? { opportunityComments } : {}), ...(milestoneComments ? { milestoneComments } : {})
  }
}

export function prepareRequestFor(opportunity: WorkingSessionOpportunity, milestone: WorkingSessionMilestone, topic: WorkingSessionTopic, deliverables: WorkingSessionDeliverables): WorkingSessionPrepareRequest {
  return {
    contractVersion: workingSessionContractVersion, opportunityId: clip(opportunity.id, 200),
    opportunityName: clip(opportunity.name, 300) || 'Opportunity', milestoneName: clip(milestone.name, 300) || 'Milestone', topic, deliverables
  }
}

/** The editable form of a topic: lists become one value per line (or comma-separated for services). */
export interface TopicDraft {
  topic: string; domain: string; azureServices: string; deckQueries: string; learnQueries: string; iacScenario: string
  confidence: WorkingSessionTopic['confidence']; basis: WorkingSessionTopic['basis']; evidence: string[]
}

export function draftFromTopic(topic: WorkingSessionTopic): TopicDraft {
  return {
    topic: topic.topic, domain: topic.domain, azureServices: topic.azureServices.join(', '),
    deckQueries: topic.deckQueries.join('\n'), learnQueries: topic.learnQueries.join('\n'), iacScenario: topic.iacScenario,
    confidence: topic.confidence, basis: topic.basis, evidence: topic.evidence
  }
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

export function topicFromDraft(draft: TopicDraft): { topic: WorkingSessionTopic } | { error: string } {
  const parsed = workingSessionTopicSchema.safeParse({
    topic: draft.topic.trim(), domain: draft.domain.trim() || 'Azure platform',
    azureServices: draft.azureServices.split(',').map((value) => value.trim()).filter(Boolean),
    deckQueries: lines(draft.deckQueries), learnQueries: lines(draft.learnQueries), iacScenario: draft.iacScenario.trim(),
    confidence: draft.confidence, basis: draft.basis, evidence: draft.evidence
  })
  if (parsed.success) return { topic: parsed.data }
  const field = String(parsed.error.issues[0]?.path[0] ?? '')
  const names: Record<string, string> = { topic: 'Topic', azureServices: 'Azure services (up to 8)', deckQueries: 'Deck searches (1 to 5 lines)', learnQueries: 'Learn searches (1 to 5 lines)', iacScenario: 'Template description' }
  return { error: `Check ${names[field] ?? 'the topic'}.` }
}

/** Removes transport prefixes (Electron IPC, bridge) so the user sees only the reason. */
export function workingSessionFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:[A-Za-z]*Error):\s*/, '').trim()
  return message || 'The working session could not be prepared.'
}

const kindHeadings: Record<WorkingSessionFile['kind'], string> = { deck: 'Decks', learn: 'Microsoft Learn', iac: 'Deployment templates', manifest: 'About this folder' }
const kindOrder: Array<WorkingSessionFile['kind']> = ['deck', 'learn', 'iac', 'manifest']

export function groupFiles(files: readonly WorkingSessionFile[]): Array<{ kind: WorkingSessionFile['kind']; heading: string; files: WorkingSessionFile[] }> {
  return kindOrder.map((kind) => ({ kind, heading: kindHeadings[kind], files: files.filter((file) => file.kind === kind) })).filter((group) => group.files.length > 0)
}

export const confidenceLabel = (topic: Pick<TopicDraft, 'confidence' | 'basis'>): string =>
  `${topic.basis === 'model' ? 'Suggested by the model' : 'Matched from the titles and comments'} - ${topic.confidence} confidence`
