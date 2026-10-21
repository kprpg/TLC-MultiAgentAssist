import { AsyncLocalStorage } from 'node:async_hooks'
import { createPerformanceReporter, type PerformanceReporter } from '../../../packages/common/telemetry/performance.js'

const requestContext = new AsyncLocalStorage<string>()

export function withTeamsPerformanceContext<T>(correlationId: string, action: () => Promise<T>): Promise<T> {
  return requestContext.run(correlationId, action)
}

export function createTeamsPerformanceReporter(environment: NodeJS.ProcessEnv): PerformanceReporter | undefined {
  const report = createPerformanceReporter(environment['TLC_TEAMS_PERFORMANCE'] === '1', (message) => console.info(`[teams-performance] ${message}`))
  return report ? (event) => {
    const correlationId = requestContext.getStore()
    report({ ...event, ...(correlationId ? { correlationId } : {}) })
  } : undefined
}
