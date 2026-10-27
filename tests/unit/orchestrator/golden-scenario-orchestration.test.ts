import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AzureCliCredential } from '@azure/identity'
import { contractVersion } from '../../../packages/common/contracts/index.js'
import { workflowAgentCapabilityValues } from '../../../packages/common/contracts/workflows.js'
import { loadFoundryEnvironmentFromEnvironment } from '../../../packages/common/configuration/foundry-environment.js'
import { FixtureMsxConnector } from '../../../packages/connectors/msx/index.js'
import { FixtureMcemGuidanceConnector } from '../../../packages/connectors/sharepoint/index.js'
import { ThinSliceOrchestrator, type TaskAgentRegistry } from '../../../packages/orchestrator/index.js'
import { createDeterministicLiveTaskAgents, createFoundryTaskAgents } from '../../../packages/orchestrator/task-agents.js'
import {
    evaluateGoldenScenarios, goldenScenarioFileSchema, sharedPresentationChecks, type GoldenScenarioReport
} from '../../../packages/orchestrator/evaluation/golden-scenarios.js'

async function runThroughOrchestrator(agents: TaskAgentRegistry, mode: 'sample' | 'live'): Promise<GoldenScenarioReport[]> {
    const msx = new FixtureMsxConnector()
    const orchestrator = new ThinSliceOrchestrator(msx, new FixtureMcemGuidanceConnector(), agents)
    const account = (await msx.listAccounts())[0]!
    const opportunity = (await msx.listOpportunities(account.id))[0]!
    const reports: GoldenScenarioReport[] = []
    for (const capability of workflowAgentCapabilityValues) {
        const file = goldenScenarioFileSchema.parse(JSON.parse(await readFile(resolve(`packages/agents/${capability}/golden-scenarios.json`), 'utf8')))
        reports.push(await evaluateGoldenScenarios({
            file, mode, checks: sharedPresentationChecks,
            invoke: async (prompt) => {
                const response = await orchestrator.runAgentTask({ contractVersion, capability, accountId: account.id, opportunityId: opportunity.id, prompt })
                return { content: response.content, agentVersion: response.agentVersion }
            }
        }))
    }
    return reports
}

async function record(name: string, reports: GoldenScenarioReport[]): Promise<void> {
    await mkdir(resolve('test-results'), { recursive: true })
    await writeFile(resolve('test-results', name), `${JSON.stringify(reports, null, 2)}\n`, 'utf8')
}

describe('golden scenarios executed through the orchestrator', () => {
    it('runs all prompt-agent scenarios against the deterministic fallback and records a metadata-only report', async () => {
        const reports = await runThroughOrchestrator(createDeterministicLiveTaskAgents(), 'sample')
        await record('golden-evaluation-deterministic.json', reports)

        expect(reports.map(({ agent }) => agent).sort()).toEqual(['tlc-account-pulse', 'tlc-mcem-coach', 'tlc-pursuit-executive', 'tlc-risk-solution-play'])
        for (const report of reports) {
            expect(report.agentVersion).toBe('guidance-live-v1')
            expect(report.scenarioErrors).toEqual([])
            expect(report.summary.accepted + report.summary.rejected + report.summary.notEvaluated).toBe(report.summary.total)
            // Most behavioural expectations need a model-quality judge; they must be reported, not assumed.
            expect(report.summary.notEvaluated).toBeGreaterThan(0)
            expect(report.outcome).not.toBe('passed')
        }
        expect(JSON.stringify(reports)).not.toMatch(/Contoso|Fabrikam|Northwind/)
    })

    const liveEvaluation = process.env['TLC_RUN_LIVE_EVAL'] === '1'
    it.skipIf(!liveEvaluation)('opt-in: runs the same scenarios against the deployed Foundry prompt agents', async () => {
        const environment = await loadFoundryEnvironmentFromEnvironment(process.env, process.cwd())
        const credential = new AzureCliCredential({ tenantId: environment.authentication.foundryTenantId, processTimeoutInMs: 30_000 })
        const reports = await runThroughOrchestrator(createFoundryTaskAgents(environment, credential), 'live')
        await record('golden-evaluation-live.json', reports)
        expect(reports.every((report) => report.scenarioErrors.length === 0)).toBe(true)
    }, 600_000)
})
