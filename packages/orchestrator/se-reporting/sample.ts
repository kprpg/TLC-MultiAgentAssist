import { createSeReportingFixture, sampleSeProfile } from '../../common/fixtures/se-reporting.js'
import { seReportRelativePath } from '../../documents/se-reporting.js'
import { SeReportingError, type SeReportingSource } from '../../connectors/se-reporting/types.js'
import { buildSeReports, consolidateSeReports } from './model.js'
import { MemorySeProfileStore, SharedSeReportingHost } from './host.js'
import type { SampleInference } from '../sample-inference.js'

export function createSampleSeReportingHost(options: { inference?: SampleInference } = {}) {
    const fixture = createSeReportingFixture()
    const reports = buildSeReports(fixture)
    const profiles = new MemorySeProfileStore()
    void profiles.save(fixture.owner.email, sampleSeProfile)
    const source: SeReportingSource = {
        inspect: async (_profile, test) => {
            if (test) throw new SeReportingError('sample-test-contract', 'The synthetic sample is already isolated. Use a configured live profile to validate an explicit real test contract.')
            return { owner: fixture.owner, contract: fixture.contract, assignments: fixture.assignments, access: fixture.access, mappingGaps: [] }
        },
        checkAccess: async () => fixture.access,
        collect: async (profile, inspection, options) => ({ ...createSeReportingFixture(), ...inspection,
            profileId: profile.id, runId: options.runId, period: options.period, pillar: options.pillar }),
        preview: async (_profile, rows) => rows.flatMap((report) => (['html', 'json'] as const).map((extension) => ({
            path: seReportRelativePath(report, extension), exists: false, status: 'Synthetic destination', url: '', etag: null
        }))),
        publish: async () => []
    }
    return new SharedSeReportingHost({
        mode: 'sample', owner: async () => ({ key: fixture.owner.email, email: fixture.owner.email }), source, profiles,
        ...(options.inference ? { inference: options.inference } : {}),
        initialRun: { id: fixture.runId, profileId: sampleSeProfile.id, reports: [...reports, consolidateSeReports(reports)], pillars: ['infra'] }
    })
}
