import { describe, expect, it } from 'vitest'
import { filterVisibleMilestones } from '../../../apps/shared/milestone-visibility.js'

const asOf = new Date('2026-10-06T20:00:00.000Z')

describe('milestone visibility', () => {
  it('hides cancelled and closed statuses after trimming and case normalization', () => {
    const milestones = [
      { id: 'cancelled', status: ' Cancelled ' },
      { id: 'closed', status: 'CLOSED' },
      { id: 'completed', status: 'Completed' },
      { id: 'active', status: 'On Track' }
    ]

    expect(filterVisibleMilestones(milestones, asOf).map((item) => item.id))
      .toEqual(['completed', 'active'])
  })

  it('hides only target dates strictly earlier than four calendar months ago', () => {
    const milestones = [
      { id: 'older', status: 'On Track', targetDate: '2026-06-05' },
      { id: 'cutoff', status: 'On Track', targetDate: '2026-06-06' },
      { id: 'recent', status: 'On Track', targetDate: '2026-06-07' },
      { id: 'future', status: 'On Track', targetDate: '2027-01-01' },
      { id: 'undated', status: 'On Track' }
    ]

    expect(filterVisibleMilestones(milestones, asOf).map((item) => item.id))
      .toEqual(['cutoff', 'recent', 'future', 'undated'])
  })

  it.each([
    ['2026-06-30T12:00:00.000Z', '2026-02-27', '2026-02-28'],
    ['2024-06-30T12:00:00.000Z', '2024-02-28', '2024-02-29']
  ])('clamps month-end cutoffs for %s', (currentDate, hiddenDate, visibleDate) => {
    const milestones = [
      { id: 'hidden', status: 'On Track', targetDate: hiddenDate },
      { id: 'visible', status: 'On Track', targetDate: visibleDate }
    ]

    expect(filterVisibleMilestones(milestones, new Date(currentDate)).map((item) => item.id))
      .toEqual(['visible'])
  })

  it('preserves input order and object identity without mutating the fetched collection', () => {
    const visible = Object.freeze({ id: 'visible', status: 'On Track', targetDate: '2026-10-01' })
    const hidden = Object.freeze({ id: 'hidden', status: 'Closed', targetDate: '2026-10-02' })
    const milestones = Object.freeze([visible, hidden])

    const result = filterVisibleMilestones(milestones, asOf)

    expect(result).toEqual([visible])
    expect(result[0]).toBe(visible)
    expect(milestones).toEqual([visible, hidden])
  })

  it('rejects an invalid as-of date explicitly', () => {
    expect(() => filterVisibleMilestones([], new Date(Number.NaN)))
      .toThrow('A valid as-of date is required.')
  })
})
