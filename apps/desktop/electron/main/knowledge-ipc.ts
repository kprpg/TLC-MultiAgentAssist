import { knowledgeSearchRequestSchema, knowledgeSearchResponseSchema } from '../../../../packages/common/contracts/knowledge.js'
import type { KnowledgeSearch } from '../../../../packages/orchestrator/knowledge-search.js'

export const knowledgeSearchIpcChannel = 'tlc:search-knowledge'
export function createKnowledgeSearchIpcHandler(host: KnowledgeSearch) {
  return async (input: unknown) => knowledgeSearchResponseSchema.parse(
    await host.searchKnowledge(knowledgeSearchRequestSchema.parse(input)))
}
