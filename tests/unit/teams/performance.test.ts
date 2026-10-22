import { afterEach, expect, it, vi } from 'vitest'
import { createTeamsPerformanceReporter, withTeamsPerformanceContext } from '../../../apps/teams/src/performance.js'

afterEach(() => { vi.restoreAllMocks() })

it('keeps opt-in technical timing correlated to the correct concurrent HTTP request', async () => {
  const emit = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  expect(createTeamsPerformanceReporter({})).toBeUndefined()
  const report = createTeamsPerformanceReporter({ TLC_TEAMS_PERFORMANCE: '1' })
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  await Promise.all(ids.map((correlationId) => withTeamsPerformanceContext(correlationId, async () => {
    await Promise.resolve()
    report?.({ operation: 'msx.http.read', durationMs: 10, outcome: 'success' })
  })))
  expect(emit.mock.calls.map(([value]) => JSON.parse(String(value).replace('[teams-performance] ', '')).correlationId).sort()).toEqual(ids)
  expect(emit.mock.calls.every(([value]) => Object.keys(JSON.parse(String(value).replace('[teams-performance] ', ''))).sort().join(',') === 'correlationId,durationMs,operation,outcome')).toBe(true)
})
