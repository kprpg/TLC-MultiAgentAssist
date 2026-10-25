import { AzureCliCredential } from '@azure/identity'
import { describe, expect, it } from 'vitest'
import { seMilestoneSchema, seTaskSchema } from '../../packages/common/contracts/se-reporting.js'
import { LiveMsxConnector } from '../../packages/connectors/msx/index.js'
import { DataverseSeReader } from '../../packages/connectors/se-reporting/dataverse.js'

const msxOrigin = 'https://microsoftsales.crm.dynamics.com'

// Opt-in read-only acceptance for the SE Dataverse provider: counts and contract validity only.
describe.skipIf(process.env['TLC_RUN_LIVE_SMOKE'] !== '1')('SE reporting Dataverse provider live acceptance', () => {
    const credential = new AzureCliCredential({ processTimeoutInMs: 30_000 })
    const msx = new LiveMsxConnector({ getAccessToken: async () => (await credential.getToken(`${msxOrigin}/.default`)).token })
    const reader = new DataverseSeReader(msx)

    it('reads the signed-in user milestone-team inventory and owned tasks into valid SE rows', async () => {
        const me = await msx.getCurrentUserId()
        const milestones = await reader.readMilestones(me)
        const tasks = await reader.readTasks(me, { fiscalStart: '2026-07-01', start: '2026-09-01', endExclusive: '2026-10-01' })
        console.info('se dataverse live', JSON.stringify({
            milestones: milestones.milestones.length, milestoneGaps: milestones.gaps.length,
            statuses: [...new Set(milestones.milestones.map((row) => row.status))].length,
            tasks: tasks.tasks.length, taskGaps: tasks.gaps.length
        }))
        expect(milestones.milestones.every((row) => seMilestoneSchema.safeParse(row).success)).toBe(true)
        expect(tasks.tasks.every((row) => seTaskSchema.safeParse(row).success)).toBe(true)
        expect(milestones.milestones.length).toBeGreaterThan(0)
    }, 240_000)
})
