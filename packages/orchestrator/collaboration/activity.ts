import { z } from 'zod'
import { workflowRunSchema, type WorkflowRun } from '../../common/contracts/workflows.js'
import type { ScopedDocumentStore } from '../../connectors/common/scoped-document-store.js'
import { principalPartition, requireRole, type ExecutionPrincipal, type PrincipalIdentity } from './principal.js'

const summarySchema = z.object({
  runId: z.uuid(), workflowId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  state: z.enum(['complete', 'partial', 'unauthorized']).optional(),
  updatedAt: z.iso.datetime()
}).strict()
export class WorkflowActivityStore {
  constructor(private readonly store: ScopedDocumentStore) {}
  async record(principal: PrincipalIdentity, input: WorkflowRun): Promise<void> {
    const run = workflowRunSchema.parse(input)
    const key = `workflow:${run.runId}`
    const partition = principalPartition(principal)
    const value = summarySchema.parse({
      runId: run.runId, workflowId: run.workflowId, status: run.status,
      ...(run.state ? { state: run.state } : {}), updatedAt: new Date().toISOString()
    })
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.store.read(partition, key)
      if (row ? await this.store.replace(partition, key, row.revision, value) : await this.store.insert(partition, key, value)) return
    }
    throw new Error('The workflow activity record changed concurrently.')
  }
  async list(principal: ExecutionPrincipal, available: (runId: string) => boolean) {
    requireRole(principal, 'TLC.Teams.User')
    return (await this.store.list(principalPartition(principal), 'workflow:', 100)).map((row) => {
      const value = summarySchema.parse(row.value)
      return ['queued', 'running'].includes(value.status) && !available(value.runId)
        ? { ...value, status: 'interrupted', detail: 'The run is unavailable on this host. No transparent resume is claimed; check the execution owner before starting another run.' }
        : value
    })
  }
}
