import type {
    SeAccess, SeAssignment, SeLiveContract, SeReport, SeReportingInput, SeReportingProfile
} from '../../common/contracts/se-reporting.js'

export { seReportingScopes, type SeReportingResource } from '../../common/contracts/se-reporting.js'
export class SeReportingError extends Error {
    constructor(readonly code: string, message: string, readonly access: SeAccess[] = []) {
        super(message)
        this.name = 'SeReportingError'
    }
}
export interface SeReportingInspection {
    owner: SeReportingInput['owner']
    contract: SeLiveContract
    assignments: SeAssignment[]
    mappingGaps: string[]
    access: SeAccess[]
}
export interface SePublishFile {
    path: string
    exists: boolean
    status: string
    url: string
    etag: string | null
}
export interface SeReportingSource {
    inspect(profile: SeReportingProfile, testContract?: { name: string; text: string }): Promise<SeReportingInspection>
    checkAccess(profile: SeReportingProfile, inspection: SeReportingInspection): Promise<SeAccess[]>
    collect(profile: SeReportingProfile, inspection: SeReportingInspection, options: {
        period: string; pillar: string; allowUnavailable: string[]; runId: string
    }): Promise<SeReportingInput>
    preview(profile: SeReportingProfile, reports: SeReport[]): Promise<SePublishFile[]>
    publish(profile: SeReportingProfile, reports: SeReport[], files: SePublishFile[]): Promise<string[]>
}
export interface SeProfileStore {
    list(owner: string): Promise<SeReportingProfile[]>
    save(owner: string, profile: SeReportingProfile): Promise<void>
}
