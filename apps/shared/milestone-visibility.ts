export interface MilestoneVisibilityFields {
  status: string
  targetDate?: string
}

const hiddenStatuses = new Set(['cancelled', 'closed'])

export function filterVisibleMilestones<T extends MilestoneVisibilityFields>(
  milestones: readonly T[],
  asOf: Date = new Date()
): T[] {
  const cutoff = fourCalendarMonthsBefore(asOf)
  return milestones.filter((milestone) =>
    !hiddenStatuses.has(milestone.status.trim().toLowerCase()) &&
    (milestone.targetDate === undefined || milestone.targetDate >= cutoff))
}

function fourCalendarMonthsBefore(asOf: Date): string {
  if (Number.isNaN(asOf.getTime())) throw new RangeError('A valid as-of date is required.')

  const year = asOf.getUTCFullYear()
  const month = asOf.getUTCMonth() - 4
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cutoff = new Date(Date.UTC(year, month, Math.min(asOf.getUTCDate(), lastDay)))
  return cutoff.toISOString().slice(0, 10)
}
