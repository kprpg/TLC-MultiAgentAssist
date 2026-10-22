import { describe, expect, it, vi } from 'vitest'
import { createPerformanceReporter, measurePerformance, type PerformanceEvent } from '../../../packages/common/index.js'

describe('performance telemetry', () => {
  it('is opt-in and serializes only technical operation, duration and outcome fields', () => {
    const emit = vi.fn()
    expect(createPerformanceReporter(false, emit)).toBeUndefined()
    const report = createPerformanceReporter(true, emit)
    const event = { operation: 'msx.http.read', durationMs: 12, outcome: 'success' as const, token: 'must-not-be-logged', customer: 'must-not-be-logged' }
    report?.(event)
    expect(emit).toHaveBeenCalledWith('{"operation":"msx.http.read","durationMs":12,"outcome":"success"}')
  })
  it('reports duration without changing the operation result', async () => {
    const events: PerformanceEvent[] = []

    await expect(measurePerformance('agent.invoke.test', (event) => events.push(event), async () => 'result'))
      .resolves.toBe('result')
    expect(events).toEqual([
      expect.objectContaining({ operation: 'agent.invoke.test', outcome: 'success' })
    ])
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does not let a reporter failure interrupt the operation', async () => {
    await expect(measurePerformance('test', vi.fn(() => { throw new Error('reporter failed') }), async () => 'result'))
      .resolves.toBe('result')
  })
})