import { describe, expect, it } from 'vitest'
import {
  createMilestoneActivityRequestSchema,
  milestoneActivitySchema,
  taskCategorySchema
} from '../../packages/common/index.js'

describe('milestone activity contracts', () => {
  it('parses a valid activity and rejects a bad priority', () => {
    const activity = milestoneActivitySchema.parse({
      id: 'act-1', milestoneId: 'ms-1', opportunityId: 'opp-1', subject: 'Design session', activityType: 'task', status: 'Open', priority: 'Normal'
    })
    expect(activity.priority).toBe('Normal')
    expect(milestoneActivitySchema.safeParse({ id: 'act-1', milestoneId: 'ms-1', opportunityId: 'opp-1', subject: 'x', activityType: 'task', status: 'Open', priority: 'Urgent' }).success).toBe(false)
  })

  it('requires a subject and defaults priority to Normal on the create request', () => {
    const parsed = createMilestoneActivityRequestSchema.parse({ subject: 'Follow up' })
    expect(parsed.priority).toBe('Normal')
    expect(createMilestoneActivityRequestSchema.safeParse({ subject: '' }).success).toBe(false)
    expect(createMilestoneActivityRequestSchema.safeParse({ subject: 'x', extra: 1 }).success).toBe(false)
  })

  it('validates the Task Category option set and the due date format', () => {
    expect(taskCategorySchema.options).toContain('Architecture Design Session')
    expect(createMilestoneActivityRequestSchema.safeParse({ subject: 'x', taskCategory: 'Not A Category' }).success).toBe(false)
    expect(createMilestoneActivityRequestSchema.safeParse({ subject: 'x', due: 'not-a-date' }).success).toBe(false)
    expect(createMilestoneActivityRequestSchema.parse({ subject: 'x', taskCategory: 'Demo', due: '2027-01-15', durationMinutes: 30 }).durationMinutes).toBe(30)
  })
})
