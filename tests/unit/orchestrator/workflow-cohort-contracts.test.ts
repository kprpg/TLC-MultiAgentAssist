import { describe, expect, it } from 'vitest'
import {
    initialWorkflowDefinitions,
    initialWorkflowIds,
    initialWorkflowInputSchemas,
    initialWorkflowOutputSchema,
    parseInitialWorkflowInput
} from '../../../packages/orchestrator/workflows/index.js'

describe('initial workflow cohort contracts', () => {
    it('publishes one canonical, deterministic definition for each approved workflow', () => {
        expect(initialWorkflowDefinitions.map(({ id }) => id)).toEqual(initialWorkflowIds)
        expect(initialWorkflowDefinitions.map(({ executionMode }) => executionMode)).toEqual([
            'composite', 'composite', 'composite', 'composite', 'composite', 'composite', 'deterministic', 'deterministic', 'composite'
        ])
        expect(initialWorkflowDefinitions.every(({ auth, scope }) =>
            !auth.allowedWrite && scope === 'portfolio')).toBe(true)
        expect(initialWorkflowDefinitions.map(({ connectorPlan }) => connectorPlan.map(({ connector }) => connector))).toEqual([
            ['dataverse-mcp', 'msx-mcp'],
            ['dataverse-mcp', 'msx-mcp'],
            ['dataverse-mcp', 'msx-mcp'],
            ['dataverse-mcp', 'msx-mcp'],
            ['dataverse-mcp', 'msx-mcp'],
            ['dataverse-mcp', 'msx-mcp'],
            ['dataverse-mcp'],
            ['dataverse-mcp'],
            ['dataverse-mcp', 'msx-mcp']
        ])
    })

    it('keeps every definition and schema reference versioned', () => {
        for (const definition of initialWorkflowDefinitions) {
            expect(definition.version).toBe('1.0.0')
            expect(definition.inputSchemaRef).toBe(`workflow-input-${definition.id.toLowerCase()}.v1`)
            expect(definition.outputSchemaRef).toBe(`workflow-output-${definition.id.toLowerCase()}.v1`)
        }
    })

    it('applies defaults while rejecting malformed, unknown, and out-of-range input', () => {
        expect(parseInitialWorkflowInput('WF-001', { asOf: '2026-09-12' })).toEqual({
            asOf: '2026-09-12', staleAfterDays: 30
        })
        expect(parseInitialWorkflowInput('WF-010', { asOf: '2026-09-12' })).toEqual({
            asOf: '2026-09-12', followUpAfterDays: 14
        })
        expect(parseInitialWorkflowInput('WF-007', { asOf: '2026-09-12' })).toEqual({
            asOf: '2026-09-12', meetingWindowDays: 14
        })
        expect(() => initialWorkflowInputSchemas['WF-002'].parse({ asOf: 'not-a-date' })).toThrow()
        expect(() => initialWorkflowInputSchemas['WF-005'].parse({ asOf: '2026-09-12', lookbackDays: 91 })).toThrow()
        expect(() => initialWorkflowInputSchemas['WF-009'].parse({ asOf: '2026-09-12', unexpected: true })).toThrow()
    })

    it('accepts normalized card, queue, lineage, and source-health output and rejects unknown fields', () => {
        const output = {
            contractVersion: '1.0', workflowId: 'WF-002', generatedAt: '2026-09-12T10:00:00.000Z',
            scope: { kind: 'portfolio' },
            card: { kind: 'action-list', title: 'Overdue milestone triage', evidenceIds: ['call-1'], actions: [] },
            queueItems: [{
                id: 'milestone-1', workflowId: 'WF-002', priority: 'P1', title: 'Validate outcome',
                opportunityId: 'opp-1', dueDate: '2026-09-10', evidenceIds: ['call-1'], status: 'new'
            }],
            lineage: [{ connector: 'dataverse-mcp', operation: 'read_query', toolCallId: 'call-1' }],
            sourceHealth: [{
                source: 'dataverse-mcp', state: 'live', detail: 'Delegated data loaded.', checkedAt: '2026-09-12T10:00:00.000Z'
            }]
        }
        expect(initialWorkflowOutputSchema.parse(output)).toEqual(output)
        expect(() => initialWorkflowOutputSchema.parse({ ...output, rawRows: [] })).toThrow()
    })
})