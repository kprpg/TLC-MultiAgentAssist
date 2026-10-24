import { knowledgeSearchRequestSchema, type KnowledgeSearchPage, type KnowledgeSearchRequest } from '../../common/contracts/knowledge.js'
import { KnowledgeSourceError, type KnowledgeSource } from '../common/knowledge.js'

export class SeismicMCPProvider implements KnowledgeSource {
  readonly id = 'seismic-mcp' as const
  constructor(readonly mode: 'sample' | 'live' = 'live') {}

  async search(input: KnowledgeSearchRequest): Promise<KnowledgeSearchPage> {
    const request = knowledgeSearchRequestSchema.parse(input)
    if (request.source !== this.id) throw new Error('The Seismic MCP provider cannot search another knowledge source.')
    throw new KnowledgeSourceError('mcp-not-configured',
      'Direct Seismic MCP is not implemented. It requires an approved Seismic MCP app, delegated Seismic OAuth, and read-only tool approvals. Select seismic-m365 for Graph retrieval.')
  }
}
