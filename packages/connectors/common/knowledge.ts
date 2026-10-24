import type {
  KnowledgeFailureCode, KnowledgeSearchPage, KnowledgeSearchRequest, KnowledgeSourceId
} from '../../common/contracts/knowledge.js'

export interface KnowledgeSource {
  readonly id: KnowledgeSourceId
  readonly mode: 'sample' | 'live'
  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchPage>
}

export class KnowledgeSourceError extends Error {
  constructor(
    readonly code: KnowledgeFailureCode,
    message: string,
    readonly state: 'unavailable' | 'unauthorized' = 'unavailable'
  ) {
    super(message)
    this.name = 'KnowledgeSourceError'
  }
}
