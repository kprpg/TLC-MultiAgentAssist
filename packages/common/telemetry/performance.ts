export interface PerformanceEvent {
  operation: string
  durationMs: number
  outcome: 'success' | 'failure'
  correlationId?: string
  /** Numeric counters only (for example token counts or time-to-first-token); never content or identifiers. */
  metrics?: Readonly<Record<string, number>>
}

export type PerformanceReporter = (event: PerformanceEvent) => void

export function createPerformanceReporter(enabled: boolean, emit: (message: string) => void): PerformanceReporter | undefined {
  return enabled ? (event) => emit(JSON.stringify({
    operation: event.operation, durationMs: event.durationMs, outcome: event.outcome,
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    ...(event.metrics ? { metrics: event.metrics } : {})
  })) : undefined
}

/** Reports a counter-only event (no timing span) such as token usage; failures never reach the caller. */
export function reportMetrics(
  reporter: PerformanceReporter | undefined,
  operation: string,
  durationMs: number,
  outcome: PerformanceEvent['outcome'],
  metrics: Record<string, number>
): void {
  try {
    reporter?.({ operation, durationMs: Math.round(durationMs * 10) / 10, outcome, metrics })
  } catch {
    // Telemetry must never interrupt the user operation it observes.
  }
}

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