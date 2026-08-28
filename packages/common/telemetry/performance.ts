export interface PerformanceEvent {
  operation: string
  durationMs: number
  outcome: 'success' | 'failure'
}

export type PerformanceReporter = (event: PerformanceEvent) => void

export async function measurePerformance<T>(
  operation: string,
  reporter: PerformanceReporter | undefined,
  action: () => Promise<T>
): Promise<T> {
  const startedAt = globalThis.performance.now()
  try {
    const result = await action()
    report(reporter, operation, startedAt, 'success')
    return result
  } catch (error) {
    report(reporter, operation, startedAt, 'failure')
    throw error
  }
}

function report(
  reporter: PerformanceReporter | undefined,
  operation: string,
  startedAt: number,
  outcome: PerformanceEvent['outcome']
): void {
  try {
    reporter?.({
      operation,
      durationMs: Math.round((globalThis.performance.now() - startedAt) * 10) / 10,
      outcome
    })
  } catch {
    // Telemetry must never interrupt the user operation it observes.
  }
}