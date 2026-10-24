import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'
import { contractVersion } from '../../../packages/common/contracts/version.js'
import { workflowContractVersion, workflowRunSchema } from '../../../packages/common/contracts/workflows.js'
import { WorkflowRuntimeError } from '../../../packages/orchestrator/workflows/runtime.js'

const services: Array<Awaited<ReturnType<typeof createSampleApplicationServices>>> = []
afterEach(async () => { for (const service of services.splice(0)) await service.dispose() })

async function fixture() {
  const service = await createSampleApplicationServices()
  services.push(service)
  return { service, operations: createApplicationOperations(service) }
}

describe('shared Teams operations and sample composition', () => {
  it('uses canonical sample data and existing orchestration, not network or copied UI fixtures', async () => {
    const { service, operations } = await fixture()
    const accounts = await operations.invoke('listAccounts', {})
    expect(accounts).toEqual(await service.orchestrator.listAccounts())
    expect(Array.isArray(accounts)).toBe(true)
    expect(operations.describe('updateOpportunity').effect).toBe('source')
    expect(operations.describe('addAccount').effect).toBe('preference')
    expect(() => operations.describe('__proto__')).toThrow(/unknown/i)
    await expect(operations.invoke('listAccounts', { token: 'injected' })).rejects.toThrow()
    await expect(operations.invoke('noSuchOperation', {})).rejects.toThrow(/unknown/i)
  })
  it('preserves all workflow operations and strict request contracts', async () => {
    const { service, operations } = await fixture()
    const request = { contractVersion: workflowContractVersion, scope: 'portfolio' }
    expect(await operations.invoke('workflows.list', request)).toEqual(service.workflows.listDefinitions(request))
    const definitions = service.workflows.listDefinitions(request)
    const definition = definitions[0]!
    const run = await operations.invoke('workflows.start', { contractVersion: workflowContractVersion, scope: { kind: 'portfolio' }, workflowId: definition.id })
    expect(run).toMatchObject({ workflowId: definition.id })
    await expect(operations.invoke('workflows.start', { ...request, workflowId: 'wrong' })).rejects.toThrow()
  })
  it('validates a workflow start before collecting its potentially expensive source scope', async () => {
    const { service, operations } = await fixture()
    const accounts = vi.spyOn(service.orchestrator, 'listAccounts')
    await expect(operations.invoke('workflows.start', {
      contractVersion: 'wrong', workflowId: 'WF-001', scope: { kind: 'portfolio' }
    })).rejects.toThrow()
    expect(accounts).not.toHaveBeenCalled()
  })
  it('shares real reviewed-write and MCEM semantics with the core while retaining live-creation restrictions', async () => {
    const { service, operations } = await fixture()
    const account = (await service.orchestrator.listAccounts())[0]!
    const opportunity = (await service.orchestrator.listOpportunities(account.id))[0]!
    const input = { opportunityId: opportunity.id, update: { comments: 'Reviewed sample note' } }
    const before = await operations.snapshot('updateOpportunity', input)
    expect(before).toMatchObject({ opportunity: { id: opportunity.id } })
    await operations.invoke('updateOpportunity', input)
    expect(await operations.snapshot('updateOpportunity', input)).not.toEqual(before)
    expect(await operations.invoke('runMcemCoach', { contractVersion, accountId: account.id, opportunityId: opportunity.id, prompt: 'Review stage readiness' }))
      .toMatchObject({
        capability: 'mcem-coach', mode: 'sample',
        evidence: expect.arrayContaining([expect.objectContaining({ recordId: opportunity.id })])
      })
    await expect(operations.invoke('previewRecordCreation', { target: 'live-msx' })).rejects.toThrow()
  })
  it('does not share mutable sample stores between two user sessions', async () => {
    const a = await fixture()
    const b = await fixture()
    const account = (await a.service.orchestrator.listAccounts())[0]!
    await a.operations.invoke('setAccountVisibility', { accountId: account.id, visibility: 'hidden' })
    expect((await b.service.orchestrator.listAccounts()).some((entry) => entry.id === account.id)).toBe(true)
  })
  it('can authorize joining a discoverable opportunity before it belongs to Portfolio', async () => {
    const { service, operations } = await fixture()
    const discoverable = await service.orchestrator.discoverOpportunities('infra')
    const candidate = discoverable.find((entry) => !entry.onDealTeam)
    expect(candidate).toBeDefined()
    await expect(operations.snapshot('joinDealTeam', { opportunityId: candidate!.id, domain: 'infra' })).resolves.toMatchObject({ opportunity: { id: candidate!.id } })
  })
  it('does not return cached workflow source data after the current visible source scope is removed', async () => {
    const { service, operations } = await fixture()
    const run = workflowRunSchema.parse(await operations.invoke('workflows.start', {
      contractVersion: workflowContractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' }, input: { asOf: '2026-10-17' }
    }))
    const request = { contractVersion: workflowContractVersion, runId: run.runId }
    await expect.poll(() => service.workflows.get(request).run.status).toBe('completed')
    await expect(operations.invoke('workflows.get', request)).resolves.toMatchObject({ run: { status: 'completed' } })
    for (const account of await service.orchestrator.listAccounts()) await service.orchestrator.setAccountVisibility(account.id, 'hidden')
    await expect(operations.invoke('workflows.get', request)).rejects.toThrow(/scope|access/i)
  })
  it('keeps the source scope of every retained run, however many other runs were started', async () => {
    const { service } = await fixture()
    const retained = new Set<string>()
    let counter = 0
    const runView = (runId: string) => ({ run: { contractVersion: '1.0', runId, workflowId: 'WF-001', status: 'queued', scope: { kind: 'portfolio' }, connectorCalls: [], telemetry: { correlationId: runId, cacheHit: false } } })
    const workflows = {
      ...service.workflows,
      start: () => {
        const runId = `${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000`
        retained.add(runId)
        return runView(runId).run
      },
      get: (request: { runId: string }) => {
        if (!retained.has(request.runId)) throw new WorkflowRuntimeError('run_not_found', 'not retained')
        return runView(request.runId)
      }
    } as unknown as typeof service.workflows
    const operations = createApplicationOperations({ ...service, workflows })
    const startRequest = { contractVersion: workflowContractVersion, workflowId: 'WF-001', scope: { kind: 'portfolio' } }

    const first = workflowRunSchema.parse(await operations.invoke('workflows.start', startRequest))
    for (let index = 0; index < 150; index++) {
      const run = workflowRunSchema.parse(await operations.invoke('workflows.start', startRequest))
      retained.delete(run.runId)
    }

    await expect(operations.invoke('workflows.get', { contractVersion: workflowContractVersion, runId: first.runId }))
      .resolves.toMatchObject({ run: { runId: first.runId } })
    expect(service.workflowScopes.size).toBeLessThanOrEqual(100)
  })
})
