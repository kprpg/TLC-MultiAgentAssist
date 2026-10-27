import { inferenceLabel, type InferenceExecution } from '../../packages/common/contracts/inference.js'

interface MeetingProposalSummary {
    inference?: InferenceExecution | undefined
    meetingType: string
    slots: readonly {
        checkedByDefault: boolean
        blocked: boolean
        label: string
        displayBefore?: string | undefined
        displayAfter: string
        mcemCriterion: string
        confidence: number
    }[]
    newMilestones: readonly { name: string; milestoneDate?: string | undefined }[]
    unmappedSignals: readonly { label: string; text: string }[]
}

export function meetingProposalToMarkdown(proposal: MeetingProposalSummary, opportunityName: string): string {
    const lines = [`# Meeting signals - ${opportunityName}`, '', `Meeting type: ${proposal.meetingType}`, '', '## Proposed field changes', '', '| Apply | Field | Current | Proposed | MCEM | Confidence |', '| --- | --- | --- | --- | --- | --- |']
    if (proposal.inference) lines.splice(4, 0, inferenceLabel(proposal.inference), '')
    for (const slot of proposal.slots) {
        lines.push(`| ${slot.checkedByDefault && !slot.blocked ? 'yes' : 'review'} | ${slot.label} | ${slot.displayBefore ?? '(empty)'} | ${slot.displayAfter} | ${slot.mcemCriterion} | ${Math.round(slot.confidence * 100)}% |`)
    }
    if (proposal.newMilestones.length > 0) {
        lines.push('', '## New milestones', '')
        for (const milestone of proposal.newMilestones) lines.push(`- ${milestone.name}${milestone.milestoneDate ? ` (${milestone.milestoneDate})` : ''}`)
    }
    if (proposal.unmappedSignals.length > 0) {
        lines.push('', '## Other signals (not injected)', '')
        for (const signal of proposal.unmappedSignals) lines.push(`- ${signal.label}: ${signal.text}`)
    }
    return lines.join('\n')
}
