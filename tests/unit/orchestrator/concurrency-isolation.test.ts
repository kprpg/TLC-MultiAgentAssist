import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { contractVersion } from '../../../packages/common/contracts/index.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator } from '../../../packages/orchestrator/index.js'
import { createDeterministicLiveTaskAgents } from '../../../packages/orchestrator/task-agents.js'

const users = 25
const requestsPerUser = 4

function percentile(sorted: number[], p: number): number {
    return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
}

describe('concurrent users in sample mode', () => {
    it('keeps per-user state isolated and records latency/heap metadata', async () => {
        const msx = new FixtureMsxConnector()
        const accounts = await msx.listAccounts()
        const heapBefore = process.memoryUsage().heapUsed
        const latencies: number[] = []

        const results = await Promise.all(Array.from({ length: users }, async (_, user) => {
            const orchestrator = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), createDeterministicLiveTaskAgents())
            const account = accounts[user % accounts.length]!
            const opportunity = (await msx.listOpportunities(account.id))[0]!
            const out: Array<{ accountId: string, opportunityId: string, content: string }> = []
            for (let index = 0; index < requestsPerUser; index += 1) {
                const started = performance.now()
                const response = await orchestrator.runAgentTask({
                    contractVersion, capability: 'account-pulse', accountId: account.id, opportunityId: opportunity.id,
                    prompt: 'Summarize the current account state'
                })
                latencies.push(performance.now() - started)
                out.push({ accountId: account.id, opportunityId: opportunity.id, content: response.content })
            }
            return { accountId: account.id, out }
        }))

        const sorted = [...latencies].sort((a, b) => a - b)
        const heapGrowthMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024
        await mkdir(resolve('test-results'), { recursive: true })
        await writeFile(resolve('test-results', 'concurrency-evidence.json'), `${JSON.stringify({
            mode: 'sample', users, requestsPerUser, requests: latencies.length,
            p50Ms: Number(percentile(sorted, 0.5).toFixed(2)), p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
            maxMs: Number(sorted.at(-1)!.toFixed(2)), heapGrowthMb: Number(heapGrowthMb.toFixed(2))
        }, null, 2)}\n`, 'utf8')

        expect(latencies).toHaveLength(users * requestsPerUser)
        for (const { accountId, out } of results) {
            expect(out).toHaveLength(requestsPerUser)
            expect(out.every((item) => item.accountId === accountId)).toBe(true)
            // Responses for one user must be identical across requests for the same account (no cross-user bleed).
            expect(new Set(out.map((item) => item.content)).size).toBe(1)
        }
        // Different users on the same account agree; different accounts do not share content.
        const byAccount = new Map<string, Set<string>>()
        for (const { accountId, out } of results) {
            byAccount.set(accountId, (byAccount.get(accountId) ?? new Set()).add(out[0]!.content))
        }
        for (const contents of byAccount.values()) expect(contents.size).toBe(1)
        const distinct = new Set([...byAccount.values()].map((contents) => [...contents][0]))
        expect(distinct.size).toBe(byAccount.size)
        expect(heapGrowthMb).toBeLessThan(256)
    })
})
