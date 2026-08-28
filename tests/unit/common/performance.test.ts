import { describe, expect, it, vi } from 'vitest'
import { measurePerformance, type PerformanceEvent } from '../../../packages/common/index.js'

describe('performance telemetry', () => {
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