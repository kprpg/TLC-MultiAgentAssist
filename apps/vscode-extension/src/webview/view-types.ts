/**
 * Local structural view types for the webview. Defined here (not imported from
 * packages/common) so the browser bundle stays free of Node-only imports. These mirror
 * the fields the UI renders; the extension host remains the schema authority.
 */

export interface AccountView { id: string; name: string; segment?: string }

export interface OpportunityView {
    id: string
    accountId: string
    name: string
    owner?: string
    recordedStage: number
    value: number
    currency: string
    closeDate: string
    comments?: string
}

export interface MilestoneView {
    id: string
    opportunityId: string
    name: string
    status: string
    targetDate?: string
    owner?: string
    commitment?: string
    estimatedMonthlyUsage?: number
    riskDetails?: string
    comments?: string
}

export interface MilestoneUpdateInput {
    status?: string
    riskDetails?: string
    targetDate?: string
    customerCommitment?: string
    comments?: string
}

export interface CriterionView { id: string; label: string; status: 'met' | 'partial' | 'missing'; rationale: string }
export interface RecommendationView { id: string; action: string; ownerRole: string; confidence: string }
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
    ui: { cardStyle: string }
}

export interface WorkflowRunView { runId: string; workflowId: string; status: string }

export interface WorkflowResultCardView {
    style: string
    title?: string
    metrics?: Array<{ label: string; value: string | number }>
    columns?: string[]
    rows?: Array<Record<string, unknown>>
    items?: Array<{ label?: string; title?: string; detail?: string }>
}

export interface WorkflowQueueItemView { id: string; title: string; priority: string; owner?: string; accountId?: string; opportunityId?: string }

export interface WorkflowOutputView {
    workflowId: string
    card: WorkflowResultCardView
    queueItems: WorkflowQueueItemView[]
}

export interface WorkflowRunResultView { run: WorkflowRunView; output?: WorkflowOutputView }

export interface GuidanceHandoffView {
    capability: AgentCapability
    scope: { accountId: string; opportunityId: string }
    prompt: string
    context: { queueItemTitle?: string; evidenceIds: string[] }
}

export type AgentCapability = 'account-pulse' | 'mcem-coach' | 'pursuit-executive' | 'risk-solution-play'
