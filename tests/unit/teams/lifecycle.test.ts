import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { UserRequestBudget } from '../../../packages/orchestrator/collaboration/request-budget.js'
import { WorkflowActivityStore } from '../../../packages/orchestrator/collaboration/activity.js'
import type { ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'

const principal: ExecutionPrincipal = { key: 't:u', tenantId: 't', userId: 'u', environmentId: 'e', roles: ['TLC.Teams.User'], mode: 'sample' }
const stores: SqliteDocumentStore[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function store() { const value = new SqliteDocumentStore(); stores.push(value); return value }

describe('host request admission and restart truth', () => {
  it('enforces the exact per-user threshold across instances and only resets in the next window', async () => {
    const data = store()
    let now = 120_000
    const a = new UserRequestBudget(data, () => now)
    const b = new UserRequestBudget(data, () => now)
    await a.consume(principal, 'read', 2)
    await b.consume(principal, 'read', 2)
    await expect(a.consume(principal, 'read', 2)).rejects.toThrow(/quota/i)
    await expect(b.consume({ ...principal, userId: 'other' }, 'read', 2)).resolves.toBeUndefined()
    now += 60_000
    await expect(b.consume(principal, 'read', 2)).resolves.toBeUndefined()
  })
  it('retains private run metadata but never pretends an in-memory run resumed after restart', async () => {
    const data = store()
    const activity = new WorkflowActivityStore(data)
    const run = {
      contractVersion: '1.0' as const,
      runId: '77777777-7777-4777-8777-777777777777', workflowId: 'WF-001',
      status: 'running' as const, scope: { kind: 'portfolio' as const },
      startedAt: '2026-10-17T20:00:00.000Z', connectorCalls: [],
      telemetry: { correlationId: '88888888-8888-4888-8888-888888888888', cacheHit: false }
    }
    await activity.record(principal, run)
    expect(await new WorkflowActivityStore(data).list(principal, () => false)).toMatchObject([{ runId: run.runId, status: 'interrupted' }])
    expect(await activity.list({ ...principal, userId: 'other' }, () => true)).toEqual([])
  })
})
