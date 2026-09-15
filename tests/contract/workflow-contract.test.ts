import { describe, expect, it } from 'vitest'
import {
    changeSetApprovalSchema,
    changeSetProposalSchema,
    isWorkflowRunTransitionAllowed,
    normalizeAgentTaskRequestScope,
    scopeRefSchema,
    workflowDefinitionSchema,
    workflowGuidanceHandoffSchema,
    workflowResultCardSchema,
    workflowRunSchema
} from '../../packages/common/index.js'

const runId = 'b937bda4-34f7-4e07-b2b9-bcff97acfa67'
const correlationId = '3d3a35d2-7aad-46b9-880b-d02412e355a1'

describe('workflow contracts', () => {
    it('accepts strict exception-list cards used by governance workflows', () => {
        expect(workflowResultCardSchema.parse({
            kind: 'exception-list',
            title: 'Weekly governance exceptions',
            evidenceIds: ['call-1'],
            exceptions: [{
                id: 'milestone-1',
                title: 'Blocked validation milestone',
                priority: 'P0',
                detail: 'The milestone is blocked.',
                evidenceIds: ['call-1']
            }]
        }).kind).toBe('exception-list')
        expect(() => workflowResultCardSchema.parse({
            kind: 'exception-list', title: 'Exceptions', evidenceIds: [], exceptions: [], unexpected: true
        })).toThrow()
    })

    it.each([
        { kind: 'portfolio' },
        { kind: 'account', accountId: 'account-1' },
        { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opportunity-1' }
    ])('accepts a valid $kind scope', (scope) => {
        expect(scopeRefSchema.safeParse(scope).success).toBe(true)
    })

    it.each([
        { kind: 'account' },
        { kind: 'opportunity', opportunityId: 'opportunity-1' },
        { kind: 'portfolio', accountId: 'unexpected' }
    ])('rejects an invalid scope', (scope) => {
        expect(scopeRefSchema.safeParse(scope).success).toBe(false)
    })

    it('accepts a strict deterministic workflow definition', () => {
        expect(workflowDefinitionSchema.safeParse({
            contractVersion: '1.0',
            id: 'WF-001',
            name: 'Stale opportunity sweep',
            version: '1.0.0',
            scope: 'portfolio',
            personaTargets: ['AE'],
            category: 'portfolio-hygiene',
            executionMode: 'deterministic',
            connectorPlan: [{ connector: 'dataverse-mcp', operation: 'read_query', required: true }],
            inputSchemaRef: 'workflow-input-wf-001.v1',
            outputSchemaRef: 'workflow-output-wf-001.v1',
            sla: { targetMs: 4_000, timeoutMs: 12_000 },
            auth: { requiresDelegatedUser: true, allowedWrite: false },
            ui: { cardStyle: 'exception-list', resultPriority: 'high', showInQuickLaunch: true }
        }).success).toBe(true)
    })

    it('enforces legal run state shapes and transitions', () => {
        expect(workflowRunSchema.safeParse({
            contractVersion: '1.0',
            runId,
            workflowId: 'WF-001',
            status: 'queued',
            scope: { kind: 'portfolio' },
            connectorCalls: [],
            telemetry: { correlationId, cacheHit: false }
        }).success).toBe(true)
        expect(workflowRunSchema.safeParse({
            contractVersion: '1.0',
            runId,
            workflowId: 'WF-001',
            status: 'completed',
            scope: { kind: 'portfolio' },
            connectorCalls: [],
            telemetry: { correlationId, cacheHit: false }
        }).success).toBe(false)
        expect(isWorkflowRunTransitionAllowed('queued', 'running')).toBe(true)
        expect(isWorkflowRunTransitionAllowed('completed', 'running')).toBe(false)
    })

    it('uses discriminated result-card payloads', () => {
        expect(workflowResultCardSchema.safeParse({
            kind: 'metric-strip',
            title: 'Portfolio health',
            evidenceIds: ['ev-1'],
            metrics: [{ label: 'Stale', value: 4 }]
        }).success).toBe(true)
        expect(workflowResultCardSchema.safeParse({
            kind: 'metric-strip',
            title: 'Portfolio health',
            evidenceIds: [],
            rows: []
        }).success).toBe(false)
    })

    it('normalizes a legacy opportunity request without changing its accepted shape', () => {
        expect(normalizeAgentTaskRequestScope({
            contractVersion: '1.0',
            capability: 'account-pulse',
            accountId: 'account-1',
            opportunityId: 'opportunity-1',
            prompt: 'Show account risk.'
        })).toEqual({
            contractVersion: '1.0',
            capability: 'account-pulse',
            scope: { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opportunity-1' },
            prompt: 'Show account risk.'
        })
    })

    it('accepts only bounded, evidence-backed handoffs to existing guidance capabilities', () => {
        const handoff = {
            contractVersion: '1.0',
            workflowId: 'WF-003',
            resultRef: 'workflow-result-1',
            capability: 'mcem-coach',
            scope: { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opportunity-1' },
            prompt: 'Review the stage-evidence mismatch and recommend the next action.',
            context: {
                cardTitle: 'Stage-evidence mismatch queue',
                queueItemId: 'WF-003:opportunity-1',
                queueItemTitle: 'Review stage evidence: Contoso migration',
                facts: [{ label: 'Recorded stage', value: '3' }, { label: 'Evidence status', value: 'Missing' }],
                evidenceIds: ['dv-call-1', 'msx-call-1']
            }
        }

        expect(workflowGuidanceHandoffSchema.parse(handoff)).toEqual(handoff)
        expect(() => workflowGuidanceHandoffSchema.parse({ ...handoff, capability: 'workflow-advisor' })).toThrow()
        expect(() => workflowGuidanceHandoffSchema.parse({ ...handoff, scope: { kind: 'portfolio' } })).toThrow()
        expect(() => workflowGuidanceHandoffSchema.parse({ ...handoff, context: { ...handoff.context, rawRows: [] } })).toThrow()
        expect(() => workflowGuidanceHandoffSchema.parse({ ...handoff, prompt: 'x'.repeat(1_001) })).toThrow()
        expect(() => workflowGuidanceHandoffSchema.parse({
            ...handoff,
            context: { ...handoff.context, facts: [{ label: 'Details', value: 'x'.repeat(501) }] }
        })).toThrow()
    })
})

describe('change-set contracts', () => {
    it('requires itemized evidence and an actual before/after change', () => {
        const baseItem = {
            itemId: '86586e85-db6a-4c12-8e81-682290276905',
            entity: 'opportunity',
            recordId: 'opportunity-1',
            field: 'status',
            before: 'Open',
            after: 'Won',
            rationale: 'Customer confirmed signature.',
            evidenceIds: ['ev-1']
        }
        const proposal = {
            contractVersion: '1.0',
            changeSetId: '32bf4cbc-ddc2-40b2-beeb-554369addb04',
            proposedByCorrelationId: correlationId,
            scope: { kind: 'opportunity', accountId: 'account-1', opportunityId: 'opportunity-1' },
            proposedAt: '2026-09-12T10:00:00.000Z',
            expiresAt: '2026-09-12T10:15:00.000Z',
            items: [baseItem]
        }

        expect(changeSetProposalSchema.safeParse(proposal).success).toBe(true)
        expect(changeSetProposalSchema.safeParse({ ...proposal, items: [{ ...baseItem, after: 'Open' }] }).success).toBe(false)
        expect(changeSetProposalSchema.safeParse({ ...proposal, items: [{ ...baseItem, evidenceIds: [] }] }).success).toBe(false)
    })

    it('requires explicit itemized approval with a reason', () => {
        expect(changeSetApprovalSchema.safeParse({
            contractVersion: '1.0',
            changeSetId: '32bf4cbc-ddc2-40b2-beeb-554369addb04',
            approvedItemIds: [],
            approvedAt: '2026-09-12T10:05:00.000Z',
            reason: 'ok'
        }).success).toBe(false)
    })
})