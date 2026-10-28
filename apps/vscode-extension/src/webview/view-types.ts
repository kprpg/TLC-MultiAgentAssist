/**
 * Local structural view types for the webview. Defined here (not imported from
 * packages/common) so the browser bundle stays free of Node-only imports. These mirror
 * the fields the UI renders; the extension host remains the schema authority.
 */

export interface AccountView {
    id: string
    name: string
    segment?: string | undefined
    tpid?: string | undefined
    provenance?: 'deal-team' | 'manual' | 'both' | undefined
    visibility?: 'visible' | 'hidden' | undefined
}

export interface AccountCandidateView extends AccountView {
    state: 'not-added' | 'visible' | 'hidden'
}

export interface OpportunityView {
    id: string
    accountId: string
    name: string
    owner?: string | undefined
    opportunityIntent?: string[] | undefined
    recordedStage: number
    value: number
    currency: string
    closeDate: string
    comments?: string | undefined
}

export interface PortfolioIndexView {
    contractVersion: '1.0'
    accounts: AccountView[]
    opportunities: OpportunityView[]
}

export interface PortfolioWorkspaceView extends PortfolioIndexView {
    selectedAccountId?: string
    selectedOpportunityId?: string
    milestones: MilestoneView[]
}

export type SeDomainView = 'infra' | 'data' | 'ai-apps' | 'security' | 'modern-work' | 'biz-apps' | 'devices' | 'services'

export interface DiscoverableOpportunityView extends OpportunityView {
    domain: SeDomainView
    accountName?: string | undefined
    solutionArea?: string | undefined
    technicalCapability?: string | undefined
    onDealTeam: boolean
}

export interface DealTeamJoinResultView {
    opportunityId: string
    onDealTeam: true
    alreadyMember: boolean
}

export interface DealTeamLeaveResultView {
    opportunityId: string
    onDealTeam: false
    alreadyAbsent: boolean
}

export interface MilestoneView {
    id: string
    opportunityId: string
    name: string
    status: string
    targetDate?: string | undefined
    owner?: string | undefined
    commitment?: string | undefined
    estimatedMonthlyUsage?: number | undefined
    riskDetails?: string | undefined
    comments?: string | undefined
    onMilestoneTeam?: boolean | undefined
}

export interface MilestoneTeamJoinResultView {
    opportunityId: string
    milestoneId: string
    onMilestoneTeam: true
    alreadyMember: boolean
}

export interface MilestoneTeamLeaveResultView {
    opportunityId: string
    milestoneId: string
    onMilestoneTeam: false
    alreadyAbsent: boolean
}

export interface MilestoneActivityView {
    id: string
    milestoneId: string
    opportunityId: string
    subject: string
    activityType: string
    status: string
    priority?: 'Low' | 'Normal' | 'High' | undefined
    taskCategory?: string | undefined
    due?: string | undefined
    durationMinutes?: number | undefined
    description?: string | undefined
    owner?: string | undefined
    createdBy?: string | undefined
    createdOn?: string | undefined
}

export interface CreateMilestoneActivityInput {
    subject: string
    taskCategory?: string | undefined
    description?: string | undefined
    due?: string | undefined
    priority?: 'Low' | 'Normal' | 'High' | undefined
    durationMinutes?: number | undefined
}

export interface MilestoneUpdateInput {
    status?: string | undefined
    riskDetails?: string | undefined
    targetDate?: string | undefined
    customerCommitment?: string | undefined
    comments?: string | undefined
}

export interface CriterionView { id: string; label: string; status: 'met' | 'partial' | 'missing'; rationale: string }
export interface RecommendationView {
    id: string
    action: string
    ownerRole: string
    rationale: string
    evidenceIds: string[]
    assumption: boolean
    confidence: 'high' | 'medium' | 'low'
}
export interface EvidenceView { id: string; title: string; source: string; url?: string }

export interface McemView {
    summary: string
    state: string
    recordedStage: number
    evidenceBasedStage: number
    criteria: CriterionView[]
    recommendations: RecommendationView[]
    missingData: string[]
    evidence?: EvidenceView[]
}

export interface McemTransitionView {
    opportunity: OpportunityView
    previousStage: number
    targetStage: number
    disposition: 'advanced' | 'override' | 'recycled'
    auditNote: string
}

export interface AgentTaskView { state: string; content: string }

export interface WorkflowDefinitionView {
    id: string
    name: string
    personaTargets: string[]
    category: string
    sla: { targetMs: number; timeoutMs: number }
    ui: { cardStyle: string }
}

export interface WorkflowRunView { runId: string; workflowId: string; status: string; state?: string }

export interface WorkflowResultCardView {
    style: string
    title?: string
    metrics?: Array<{ label: string; value: string | number }>
    columns?: string[]
    columnLabels?: Record<string, string>
    rows?: Array<Record<string, unknown>>
    items?: Array<{ label?: string; title?: string; detail?: string }>
}

export interface WorkflowQueueItemView {
    id: string
    title: string
    priority: string
    owner?: string
    accountId?: string
    accountName?: string
    opportunityId?: string
    opportunityName?: string
}

export interface WorkflowOutputView {
    workflowId: string
    generatedAt: string
    card: WorkflowResultCardView
    queueItems: WorkflowQueueItemView[]
    sourceHealth: Array<{ source: string; state: string; detail: string }>
}

export interface WorkflowRunResultView { run: WorkflowRunView; output?: WorkflowOutputView }
export interface WorkflowResultsMembershipView {
    runId: string
    filter: 'all' | 'mine'
    state: 'ready' | 'pending' | 'unavailable' | 'legacy'
    message?: string
    totalItems: number
    visibleItems: number
    eligibility: Array<{ queueItemId: string; eligible: boolean; reason: string }>
    output?: WorkflowOutputView
}

export interface GuidanceHandoffView {
    capability: AgentCapability
    scope: { accountId: string; opportunityId: string }
    prompt: string
    context: { queueItemTitle?: string; evidenceIds: string[] }
}

export type AgentCapability = 'account-pulse' | 'mcem-coach' | 'pursuit-executive' | 'risk-solution-play'

// ---- Meeting capture view types ---------------------------------------------------------

export type MeetingTypeView = 'customer' | 'internal'

export interface MeetingTranscriptSummaryView {
    id: string
    subject: string
    occurredAt: string
    meetingType: MeetingTypeView
    source: 'teams' | 'upload' | 'paste'
    opportunityId?: string
    opportunityName?: string
    segmentCount?: number
}

export interface MeetingTranscriptSegmentView {
    segmentId: string
    startMs?: number
    endMs?: number
    speaker?: string
    speakerRole?: MeetingTypeView
    text: string
}

export interface MeetingTranscriptView {
    id: string
    opportunityId?: string
    meetingType: MeetingTypeView
    title?: string
    source: 'teams' | 'upload' | 'paste'
    segments: MeetingTranscriptSegmentView[]
}

export interface MeetingSlotView {
    slotId: string
    label: string
    mcemCriterion: string
    targetKind: 'opportunity' | 'milestone' | 'new-milestone'
    targetRecordId?: string | undefined
    targetField: string
    valueType: 'text' | 'money' | 'date' | 'optionset' | 'boolean' | 'percent'
    displayBefore?: string | undefined
    displayAfter: string
    confidence: number
    checkedByDefault: boolean
    blocked: boolean
    blockedReason?: string | undefined
    sensitive: boolean
    rationale: string
    evidence: string[]
}

export interface MeetingNewMilestoneView {
    tempId: string
    name: string
    milestoneDate?: string | undefined
    ownerName?: string | undefined
    commitment?: 'Uncommitted' | 'Committed' | undefined
    confidence: number
    checkedByDefault: boolean
    evidence: string[]
}

export interface MeetingUnmappedSignalView {
    label: string
    text: string
    mcemCriterion: string
    evidence: string[]
}

export interface MeetingChangeSetProposalView {
    inference?: import('../../../../packages/common/contracts/inference.js').InferenceExecution | undefined
    contractVersion?: '1.3' | undefined
    changeSetId: string
    transcriptId: string
    opportunityId: string
    meetingType: MeetingTypeView
    slots: MeetingSlotView[]
    newMilestones: MeetingNewMilestoneView[]
    suggestedMilestoneIds: string[]
    unmappedSignals: MeetingUnmappedSignalView[]
    proposedAt: string
}

export interface MeetingChangeSetApprovalInput {
    changeSetId: string
    opportunityId: string
    approvedSlotIds: string[]
    approvedNewMilestoneTempIds: string[]
    selectedMilestoneIds: string[]
    reason: string
}

export interface MeetingInjectItemResultView {
    id: string
    kind: 'field' | 'new-milestone'
    state: 'applied' | 'conflict' | 'failed' | 'skipped'
    detail: string
}

export interface MeetingChangeSetResultView {
    changeSetId: string
    state: 'applied' | 'rolled-back'
    items: MeetingInjectItemResultView[]
    auditNote: string
}
