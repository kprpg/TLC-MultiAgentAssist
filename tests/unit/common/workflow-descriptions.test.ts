import { describe, expect, it } from 'vitest'
import { loadWorkflowDescriptionCatalog } from '../../../packages/common/index.js'
import { initialWorkflowIds } from '../../../packages/orchestrator/workflows/index.js'

describe('workflow description catalog', () => {
    it('describes every shipped play', async () => {
        const catalog = await loadWorkflowDescriptionCatalog('config/workflow-descriptions.json')

        expect(Object.keys(catalog.descriptions).sort()).toEqual([...initialWorkflowIds].sort())
    })

    it('rejects a catalog with unknown fields', async () => {
        await expect(loadWorkflowDescriptionCatalog('config/mcp.servers.json')).rejects.toThrow()
    })
})
