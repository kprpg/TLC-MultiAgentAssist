import { AzureCliCredential } from '@azure/identity'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { contractVersion, type PerformanceEvent } from '../../packages/common/index.js'
import { loadFoundryEnvironmentFromEnvironment } from '../../packages/common/configuration/foundry-environment.js'
import { FoundryPromptAgent } from '../../packages/connectors/foundry/index.js'
import { FixtureMsxConnector } from '../../packages/connectors/msx/index.js'
import { LocalPdfMcemGuidanceConnector } from '../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator, type AgentTaskContext } from '../../packages/orchestrator/index.js'

describe.skipIf(process.env['TLC_RUN_LIVE_SMOKE'] !== '1')('MCEM guidance latency (synthetic context, live Foundry)', () => {
  it('reports one cold and five warm runs through the shared four-surface agent path', async () => {
    const environment = await loadFoundryEnvironmentFromEnvironment()
    const events: PerformanceEvent[][] = []
    let current: PerformanceEvent[] = []
    const core = new ThinSliceOrchestrator(
      new FixtureMsxConnector(),
      new LocalPdfMcemGuidanceConnector(resolve('docs/knowledge/MCEM Overview.pdf')),
      {
        'mcem-coach': {
          version: 'active',
          agent: new FoundryPromptAgent<AgentTaskContext>({
            projectEndpoint: environment.foundry.projectEndpoint,
            agentName: environment.foundry.agents.mcemCoach.name,
            requestTimeoutMs: Math.min(environment.foundry.requestTimeoutMs, 120_000),
            credential: new AzureCliCredential({ tenantId: environment.authentication.foundryTenantId, processTimeoutInMs: 30_000 })
          })
        }
      },
      (event) => current.push(event)
    )
    for (let run = 0; run < 6; run += 1) {
      current = []
      const response = await core.runAgentTask({
        contractVersion,
        capability: 'mcem-coach',
        accountId: 'account-contoso',
        opportunityId: 'opp-grid-modernization',
        prompt: 'How do we move this opportunity to the next MCEM stage?'
      })
      expect(response.content.trim().length).toBeGreaterThan(0)
      expect(current.at(-1)).toMatchObject({ operation: 'agent.task.mcem-coach', outcome: 'success' })
      expect(current.at(-1)?.durationMs).toBeLessThan(60_000)
      events.push(current)
    }
    const cold = events[0] ?? []
    const warm = events.slice(1).flat()
    const phases = [...new Set(cold.map((event) => event.operation))]
    const summary = phases.map((operation) => {
      const values = warm.filter((event) => event.operation === operation).map((event) => event.durationMs).sort((a, b) => a - b)
      return {
        operation,
        coldMs: cold.find((event) => event.operation === operation)?.durationMs,
        warmRuns: values.length,
        warmMedianMs: values[Math.floor(values.length / 2)],
        warmP95Ms: values[Math.ceil(values.length * 0.95) - 1]
      }
    })
    console.info(`[mcem-benchmark] ${JSON.stringify(summary)}`)
    const outputPath = process.env['TLC_MCEM_BENCHMARK_OUTPUT']
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  }, 800_000)
})
