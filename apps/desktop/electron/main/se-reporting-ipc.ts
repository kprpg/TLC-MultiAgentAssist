import type { SeReportingHost } from '../../../../packages/orchestrator/se-reporting/host.js'

export const seReportingIpcChannel = 'tlc:se-reporting'
export function createSeReportingIpcHandler(host: SeReportingHost) {
    return (request: unknown) => host.invoke(request)
}
