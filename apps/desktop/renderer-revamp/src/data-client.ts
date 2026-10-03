import {
    accountSchema,
    accountCandidateSchema,
    agentTaskResponseSchema,
    contractVersion,
    dealTeamJoinResultSchema,
    dealTeamLeaveResultSchema,
    discoverableOpportunitySchema,
    mcemStageTransitionRequestSchema,
    mcemStageTransitionResultSchema,
    mcemResponseSchema,
    milestoneSchema,
    milestoneUpdateSchema,
    opportunitySchema,
    opportunityUpdateSchema,
    workflowDefinitionSchema,
    workflowGuidanceHandoffSchema,
    workflowRunSchema,
    type ScopeRef,
    type WorkflowDefinition,
    type WorkflowGuidanceHandoff,
    type WorkflowRun,
    type Account,
    type AccountCandidate,
    type AccountListOptions,
    type AccountSearchRequest,
    type AccountVisibility,
    type AgentCapability,
    type AgentTaskResponse,
    type DealTeamJoinResult,
    type DealTeamLeaveResult,
    type DesktopDataStatus,
    type DiscoverableOpportunity,
    type EmailComposeRequest,
    type EmailComposeResult,
    type ExportResponseRequest,
    type ExportResponseResult,
    type McemResponse,
    type McemStageTransitionResult,
    type Milestone,
    type MilestoneUpdate,
    type Opportunity,
    type OpportunityUpdate
} from '../../../../packages/common/contracts/index.js'
import type { SeDomainId } from '../../../../packages/common/configuration/se-domains.js'
import {
    workflowRunViewSchema,
    type WorkflowRunView
} from '../../../../packages/orchestrator/workflows/view-contracts.js'
import type { StartWorkflowHostRequest, WorkflowHostOperation } from '../../../../packages/orchestrator/workflows/host.js'

export interface RevampDataClient {
    readonly mode: 'desktop' | 'web-live' | 'web-sample'
    exitApplication(): Promise<void>
    getCurrentUserEmail(): Promise<string | undefined>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
    joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
    leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
    listMilestones(opportunityId: string): Promise<Milestone[]>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
    updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
    transitionOpportunityStage(accountId: string, opportunityId: string, targetStage: number, reason?: string): Promise<McemStageTransitionResult>
    runMcemCoach(accountId: string, opportunityId: string): Promise<McemResponse>
    runAgentTask(capability: AgentCapability, accountId: string, opportunityId: string, prompt: string): Promise<AgentTaskResponse>
    openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
    exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
    openEvidence(url: string): Promise<void>
    listWorkflowDefinitions(scope?: ScopeRef['kind']): Promise<WorkflowDefinition[]>
    startWorkflow(request: StartWorkflowHostRequest): Promise<WorkflowRun>
    getWorkflowRun(runId: string): Promise<WorkflowRunView>
    cancelWorkflowRun(runId: string): Promise<WorkflowRun>
    listWorkflowRuns(scope?: ScopeRef, limit?: number): Promise<WorkflowRun[]>
    prepareWorkflowGuidance(runId: string, queueItemId: string, capability: AgentCapability): Promise<WorkflowGuidanceHandoff>
}

type Fetcher = typeof fetch

function downloadBlob(blob: Blob, fileName: string): void {
    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0)
}

async function apiRequest(fetcher: Fetcher, path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(path, {
        ...init,
        credentials: 'same-origin',
        headers: {
            accept: 'application/json',
            ...(init?.body ? { 'content-type': 'application/json' } : {}),
            ...init?.headers
        }
    })
    const payload = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) throw new Error(payload?.error ?? `The server request failed (${response.status}).`)
    return payload
}

export function createWebApiClient(fetcher: Fetcher = fetch, mode: 'web-live' | 'web-sample' = 'web-live'): RevampDataClient {
    const invokeWorkflow = (operation: WorkflowHostOperation, request: unknown) => apiRequest(
        fetcher,
        `/api/workflows/${operation}`,
        { method: 'POST', body: JSON.stringify(request) }
    )
    return {
        mode,
        exitApplication: async () => { await apiRequest(fetcher, '/api/exit', { method: 'POST' }) },
        getCurrentUserEmail: async () => {
            const result = await apiRequest(fetcher, '/api/me') as { email?: unknown }
            return typeof result.email === 'string' ? result.email : undefined
        },
        listAccounts: async (options) => accountSchema.array().parse(await apiRequest(fetcher, `/api/accounts${options?.includeHidden ? '?includeHidden=true' : ''}`)),
        searchAccounts: async (request) => accountCandidateSchema.array().parse(await apiRequest(fetcher, `/api/account-candidates?matchBy=${encodeURIComponent(request.matchBy)}&query=${encodeURIComponent(request.query)}`)),
        addAccount: async (accountId) => accountSchema.parse(await apiRequest(fetcher, '/api/accounts', { method: 'POST', body: JSON.stringify({ accountId }) })),
        setAccountVisibility: async (accountId, visibility) => accountSchema.parse(await apiRequest(fetcher, `/api/accounts/${encodeURIComponent(accountId)}/visibility`, { method: 'PATCH', body: JSON.stringify({ visibility }) })),
        listOpportunities: async (accountId) => opportunitySchema.array().parse(await apiRequest(fetcher, `/api/accounts/${encodeURIComponent(accountId)}/opportunities`)),
        discoverOpportunities: async (domain) => discoverableOpportunitySchema.array().parse(await apiRequest(fetcher, `/api/discover/${encodeURIComponent(domain)}`)),
        joinDealTeam: async (opportunityId) => dealTeamJoinResultSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/deal-team`, { method: 'POST', body: JSON.stringify({}) })),
        leaveDealTeam: async (opportunityId) => dealTeamLeaveResultSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/deal-team`, { method: 'DELETE', body: JSON.stringify({}) })),
        listMilestones: async (opportunityId) => milestoneSchema.array().parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones`)),
        updateMilestone: async (opportunityId, milestoneId, update) => milestoneSchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'PATCH', body: JSON.stringify(milestoneUpdateSchema.parse(update)) })),
        updateOpportunity: async (opportunityId, update) => opportunitySchema.parse(await apiRequest(fetcher, `/api/opportunities/${encodeURIComponent(opportunityId)}`, { method: 'PATCH', body: JSON.stringify(opportunityUpdateSchema.parse(update)) })),
        transitionOpportunityStage: async (accountId, opportunityId, targetStage, reason) => mcemStageTransitionResultSchema.parse(await apiRequest(fetcher, '/api/mcem-stage-transition', {
            method: 'POST',
            body: JSON.stringify(mcemStageTransitionRequestSchema.parse({ contractVersion, accountId, opportunityId, targetStage, reason }))
        })),
        runMcemCoach: async (accountId, opportunityId) => mcemResponseSchema.parse(await apiRequest(fetcher, '/api/mcem-coach', {
            method: 'POST',
            body: JSON.stringify({ contractVersion, accountId, opportunityId, prompt: 'How do we move this opportunity to the next MCEM stage?' })
        })),
        runAgentTask: async (capability, accountId, opportunityId, prompt) => agentTaskResponseSchema.parse(await apiRequest(fetcher, '/api/agent-task', {
            method: 'POST',
            body: JSON.stringify({ contractVersion, capability, accountId, opportunityId, prompt })
        })),
        openEmailCompose: async (request) => {
            const response = await fetcher('/api/open-email-compose', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { accept: 'message/rfc822', 'content-type': 'application/json' },
                body: JSON.stringify(request)
            })
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null
                throw new Error(payload?.error ?? `The server request failed (${response.status}).`)
            }
            const blob = await response.blob()
            downloadBlob(blob, response.headers.get('x-tlc-file-name') || 'TLC-agent-response.eml')
            return { state: 'opened' }
        },
        exportAgentResponse: async (request) => {
            const response = await fetcher('/api/export-agent-response', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { accept: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-type': 'application/json' },
                body: JSON.stringify(request)
            })
            if (!response.ok) {
                const payload = await response.json().catch(() => null) as { error?: string } | null
                throw new Error(payload?.error ?? `The server request failed (${response.status}).`)
            }
            const blob = await response.blob()
            const fileName = response.headers.get('x-tlc-file-name') || 'TLC-agent-response.docx'
            downloadBlob(blob, fileName)
            return { state: 'saved', filePath: fileName }
        },
        openEvidence: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
        listWorkflowDefinitions: async (scope) => workflowDefinitionSchema.array().parse(await invokeWorkflow('list', { contractVersion, ...(scope ? { scope } : {}) })),
        startWorkflow: async (request) => workflowRunSchema.parse(await invokeWorkflow('start', request)),
        getWorkflowRun: async (runId) => workflowRunViewSchema.parse(await invokeWorkflow('get', { contractVersion, runId })),
        cancelWorkflowRun: async (runId) => workflowRunSchema.parse(await invokeWorkflow('cancel', { contractVersion, runId })),
        listWorkflowRuns: async (scope, limit) => workflowRunSchema.array().parse(await invokeWorkflow('history', {
            contractVersion,
            ...(scope ? { scope } : {}),
            ...(limit === undefined ? {} : { limit })
        })),
        prepareWorkflowGuidance: async (runId, queueItemId, capability) => workflowGuidanceHandoffSchema.parse(await invokeWorkflow('guidance', {
            contractVersion, runId, queueItemId, capability
        }))
    }
}

interface DesktopBridge {
    exitApplication(): Promise<void>
    getDataStatus(): Promise<DesktopDataStatus>
    listAccounts(options?: AccountListOptions): Promise<Account[]>
    searchAccounts(request: AccountSearchRequest): Promise<AccountCandidate[]>
    addAccount(accountId: string): Promise<Account>
    setAccountVisibility(accountId: string, visibility: AccountVisibility): Promise<Account>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    discoverOpportunities(domain: SeDomainId): Promise<DiscoverableOpportunity[]>
    joinDealTeam(opportunityId: string): Promise<DealTeamJoinResult>
    leaveDealTeam(opportunityId: string): Promise<DealTeamLeaveResult>
    listMilestones(opportunityId: string): Promise<Milestone[]>
    updateMilestone(opportunityId: string, milestoneId: string, update: MilestoneUpdate): Promise<Milestone>
    updateOpportunity(opportunityId: string, update: OpportunityUpdate): Promise<Opportunity>
    transitionOpportunityStage(request: { contractVersion: typeof contractVersion; accountId: string; opportunityId: string; targetStage: number; reason?: string }): Promise<McemStageTransitionResult>
    runMcemCoach(request: { contractVersion: typeof contractVersion; accountId: string; opportunityId: string; prompt: string }): Promise<McemResponse>
    runAgentTask(request: { contractVersion: typeof contractVersion; capability: AgentCapability; accountId: string; opportunityId: string; prompt: string }): Promise<AgentTaskResponse>
    openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
    exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
    openEvidence(url: string): Promise<void>
    invokeWorkflow(operation: WorkflowHostOperation, request: unknown): Promise<unknown>
}

declare global {
    interface Window {
        tlc?: DesktopBridge
    }
}

const accounts: Account[] = [
    { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic', tpid: '1000001' },
    { id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise', tpid: '1000002' },
    { id: 'account-northwind', name: 'Northwind Health', segment: 'Enterprise', tpid: '1000003' }
]

const opportunities: Opportunity[] = [
    { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', owner: 'Avery Johnson', recordedStage: 3, value: 4200000, currency: 'USD', closeDate: '2026-10-30' },
    { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', name: 'Cloud security readiness', owner: 'Jordan Lee', recordedStage: 1, value: 900000, currency: 'USD', closeDate: '2027-02-26' },
    { id: 'opp-data-estate-consolidation', accountId: 'account-contoso', name: 'Data estate consolidation', recordedStage: 2, value: 2650000, currency: 'USD', closeDate: '2027-01-29' },
    { id: 'opp-resilient-cloud-foundation', accountId: 'account-contoso', name: 'Resilient cloud foundation - ready to advance', recordedStage: 1, value: 1450000, currency: 'USD', closeDate: '2027-03-12' },
    { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', recordedStage: 2, value: 1750000, currency: 'USD', closeDate: '2026-12-18' },
    { id: 'opp-store-modernization', accountId: 'account-fabrikam', name: 'Connected store modernization', recordedStage: 1, value: 1200000, currency: 'USD', closeDate: '2027-03-19' },
    { id: 'opp-unified-commerce', accountId: 'account-fabrikam', name: 'Unified commerce platform', recordedStage: 3, value: 3800000, currency: 'USD', closeDate: '2026-12-11' },
    { id: 'opp-customer-data-platform', accountId: 'account-fabrikam', name: 'Customer data platform - ready to advance', owner: 'Morgan Lee', recordedStage: 2, value: 3200000, currency: 'USD', closeDate: '2027-01-15' }
]

const discoverableOpportunities: DiscoverableOpportunity[] = [
    { id: 'opp-discover-hybrid-networking', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Hybrid networking modernization', recordedStage: 2, value: 1850000, currency: 'USD', closeDate: '2027-02-12', domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Advanced Networking', onDealTeam: false },
    { id: 'opp-discover-vmware-migration', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Datacenter exit to Azure VMware Solution', recordedStage: 1, value: 2950000, currency: 'USD', closeDate: '2027-04-02', domain: 'infra', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure VMware Solutions', onDealTeam: false },
    { id: 'opp-discover-synapse-analytics', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Enterprise analytics on Synapse and Power BI', recordedStage: 2, value: 2100000, currency: 'USD', closeDate: '2027-01-22', domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'New Analytics with Synapse & PowerBI', onDealTeam: false },
    { id: 'opp-discover-sql-managed-instance', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'SQL Server migration to Azure SQL MI', recordedStage: 3, value: 1650000, currency: 'USD', closeDate: '2026-12-19', domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'SQL Server Migration to Azure SQL MI', onDealTeam: false },
    { id: 'opp-discover-azure-ai-ml', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Azure AI and ML platform adoption', recordedStage: 2, value: 3400000, currency: 'USD', closeDate: '2027-02-05', domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Azure AI and ML', onDealTeam: false },
    { id: 'opp-discover-cloud-native-apps', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Cloud-native apps on AKS and Cosmos DB', recordedStage: 1, value: 2750000, currency: 'USD', closeDate: '2027-03-27', domain: 'ai-apps', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB', onDealTeam: false },
    { id: 'opp-discover-zero-trust', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Zero Trust security modernization', recordedStage: 2, value: 2200000, currency: 'USD', closeDate: '2027-02-18', domain: 'security', solutionArea: 'Security', technicalCapability: 'Threat Protection', onDealTeam: false },
    { id: 'opp-discover-teams-calling', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Teams Phone and calling rollout', recordedStage: 1, value: 980000, currency: 'USD', closeDate: '2027-03-05', domain: 'modern-work', technicalCapability: 'Calling', onDealTeam: false },
    { id: 'opp-discover-d365-customer-service', accountId: 'account-fabrikam', accountName: 'Fabrikam Retail', name: 'Dynamics 365 Customer Service transformation', recordedStage: 2, value: 1750000, currency: 'USD', closeDate: '2027-01-28', domain: 'biz-apps', solutionArea: 'AI Business Solutions', technicalCapability: 'Customer Service', onDealTeam: false },
    { id: 'opp-discover-surface-deployment', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Surface device deployment and management', recordedStage: 1, value: 640000, currency: 'USD', closeDate: '2027-04-15', domain: 'devices', solutionArea: 'Windows and Devices', technicalCapability: 'Surface & Partner Devices', onDealTeam: false },
    { id: 'opp-discover-cloud-advisory', accountId: 'account-contoso', accountName: 'Contoso Energy', name: 'Cloud advisory and adoption services', recordedStage: 2, value: 850000, currency: 'USD', closeDate: '2027-02-22', domain: 'services', solutionArea: 'Microsoft Services', technicalCapability: 'Advisory Services', onDealTeam: false },
    { id: 'opp-discover-northwind-data', accountId: 'account-northwind', accountName: 'Northwind Health', name: 'Clinical data platform modernization', recordedStage: 1, value: 2100000, currency: 'USD', closeDate: '2027-05-20', domain: 'data', solutionArea: 'Cloud and AI Platforms', technicalCapability: 'Analytics', onDealTeam: false }
]

const dealTeamOpportunityIds = new Set(opportunities.map((opportunity) => opportunity.id))
const manualAccountIds = new Set<string>()
const hiddenAccountIds = new Set<string>()

function sampleAccountRows(includeHidden = false): Account[] {
    const dealTeamAccountIds = new Set(opportunities
        .filter((opportunity) => dealTeamOpportunityIds.has(opportunity.id))
        .map((opportunity) => opportunity.accountId))
    return accounts
        .filter((account) => dealTeamAccountIds.has(account.id) || manualAccountIds.has(account.id) || hiddenAccountIds.has(account.id))
        .map((account) => ({
            ...account,
            provenance: dealTeamAccountIds.has(account.id) && manualAccountIds.has(account.id)
                ? 'both' as const
                : manualAccountIds.has(account.id) ? 'manual' as const : 'deal-team' as const,
            visibility: hiddenAccountIds.has(account.id) ? 'hidden' as const : 'visible' as const
        }))
        .filter((account) => includeHidden || account.visibility !== 'hidden')
}

const milestones: Milestone[] = opportunities.flatMap((opportunity, index) => [{
    id: `${opportunity.id}-milestone`,
    opportunityId: opportunity.id,
    name: index % 2 === 0 ? 'Customer outcome validation' : 'Technical validation workshop',
    status: index % 3 === 0 ? 'On track' : 'In progress',
    targetDate: opportunity.closeDate,
    estimatedMonthlyUsage: opportunity.value / 12,
    owner: opportunity.owner ?? 'Account team',
    commitment: index % 2 === 0 ? 'Committed' : 'Best case'
}])
const criteriaLabels = ['Customer outcome', 'Decision team', 'Technical validation', 'Business case', 'Next committed step']
const roleByStage = ['Account Executive', 'Specialist / SSP', 'Solution Engineer', 'Cloud Solution Architect', 'CSAM']

function buildWebEvaluation(opportunity: Opportunity): McemResponse {
    const readyToAdvance = opportunity.name.includes('ready to advance')
    const evidenceBasedStage = readyToAdvance ? Math.min(5, opportunity.recordedStage + 1) : Math.max(1, opportunity.recordedStage - 1)
    const generatedAt = new Date().toISOString()
    const evidenceIds = [`web-msx-${opportunity.id}`, `web-mcem-stage-${opportunity.recordedStage}`]
    return {
        contractVersion,
        correlationId: '10000000-0000-4000-8000-000000000001',
        capability: 'mcem-coach',
        agentVersion: 'web-sample-v1',
        generatedAt,
        mode: 'sample',
        state: readyToAdvance ? 'complete' : 'partial',
        summary: readyToAdvance
            ? `Completed Stage ${opportunity.recordedStage} exit criteria support progression to Stage ${evidenceBasedStage}.`
            : `The opportunity is recorded at Stage ${opportunity.recordedStage}; current sample evidence supports Stage ${evidenceBasedStage}.`,
        recordedStage: opportunity.recordedStage,
        evidenceBasedStage,
        criteria: criteriaLabels.map((label, index) => ({
            id: `criterion-${index + 1}`,
            label,
            status: readyToAdvance || index < 2 ? 'met' : index === 2 ? 'partial' : 'missing',
            rationale: readyToAdvance
                ? `${label} evidence is documented and customer validated.`
                : index < 2 ? `${label} evidence is documented.` : `${label} requires customer confirmation.`,
            evidenceIds
        })),
        recommendations: readyToAdvance ? [{
            id: 'advance-stage',
            action: `Confirm progression to Stage ${evidenceBasedStage} with the customer and update MSX.`,
            ownerRole: roleByStage[opportunity.recordedStage - 1] ?? 'Account Executive',
            rationale: 'All current-stage exit criteria are represented in this sanitized sample.',
            evidenceIds,
            assumption: false,
            confidence: 'high'
        }] : [
            { id: 'validate-technical', action: 'Schedule a customer validation session for the open technical criterion.', ownerRole: 'Solution Engineer', rationale: 'Technical validation remains partial in sample evidence.', evidenceIds, assumption: false, confidence: 'high' },
            { id: 'confirm-business-case', action: 'Confirm the quantified business case and economic buyer.', ownerRole: 'Specialist / SSP', rationale: 'The business case is not yet supported in sample evidence.', evidenceIds, assumption: false, confidence: 'medium' }
        ],
        missingData: readyToAdvance ? [] : ['Validated business case', 'Customer-confirmed next step'],
        evidence: [
            { id: evidenceIds[0]!, source: 'msx', recordId: opportunity.id, title: 'Sanitized MSX opportunity snapshot', retrievedAt: generatedAt, accessContext: 'sample', quality: 'observed', excerpt: 'Static web preview data; no live MSX request was made.' },
            { id: evidenceIds[1]!, source: 'mcem', recordId: `stage-${opportunity.recordedStage}`, title: `MCEM Stage ${opportunity.recordedStage} guidance`, retrievedAt: generatedAt, accessContext: 'sample', quality: 'authoritative', excerpt: 'Versioned stage criteria used for the sample evaluation.' }
        ],
        sourceHealth: [
            { source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt },
            { source: 'mcem', state: 'sample', detail: 'Bundled sample guidance.', checkedAt: generatedAt }
        ]
    }
}

function webClient(): RevampDataClient {
    return {
        mode: 'web-sample',
        exitApplication: async () => { await apiRequest(fetch, '/api/exit', { method: 'POST' }) },
        getCurrentUserEmail: async () => undefined,
        listAccounts: async (options) => structuredClone(sampleAccountRows(options?.includeHidden)),
        searchAccounts: async (request) => {
            const query = request.query.trim().toLocaleLowerCase()
            const currentById = new Map(sampleAccountRows(true).map((account) => [account.id, account]))
            return structuredClone(accounts
                .filter((account) => request.matchBy === 'name'
                    ? account.name.toLocaleLowerCase().includes(query)
                    : account.tpid === request.query.trim())
                .map((account) => {
                    const current = currentById.get(account.id)
                    return {
                        ...(current ?? account),
                        state: current?.visibility === 'hidden' ? 'hidden' as const : current ? 'visible' as const : 'not-added' as const
                    }
                }))
        },
        addAccount: async (accountId) => {
            const account = accounts.find((item) => item.id === accountId)
            if (!account) throw new Error('Unknown sample account.')
            manualAccountIds.add(accountId)
            return structuredClone(sampleAccountRows(true).find((item) => item.id === accountId)!)
        },
        setAccountVisibility: async (accountId, visibility) => {
            const account = accounts.find((item) => item.id === accountId)
            if (!account) throw new Error('Unknown sample account.')
            if (visibility === 'hidden') hiddenAccountIds.add(accountId)
            else hiddenAccountIds.delete(accountId)
            const current = sampleAccountRows(true).find((item) => item.id === accountId)
            return structuredClone(current ?? { ...account, visibility })
        },
        listOpportunities: async (accountId) => structuredClone(opportunities.filter((item) =>
            item.accountId === accountId && dealTeamOpportunityIds.has(item.id) && !hiddenAccountIds.has(accountId))),
        discoverOpportunities: async (domain) => {
            const visibleAccountIds = new Set(sampleAccountRows().map((account) => account.id))
            return structuredClone(discoverableOpportunities
                .filter((item) => item.domain === domain && visibleAccountIds.has(item.accountId))
                .map((item) => ({ ...item, onDealTeam: dealTeamOpportunityIds.has(item.id) })))
        },
        joinDealTeam: async (opportunityId) => {
            const seed = discoverableOpportunities.find((item) => item.id === opportunityId)
            if (!seed) throw new Error('Unknown sample opportunity.')
            const alreadyMember = dealTeamOpportunityIds.has(opportunityId)
            if (!alreadyMember) {
                dealTeamOpportunityIds.add(opportunityId)
                if (!opportunities.some((item) => item.id === opportunityId)) {
                    const { domain, accountName, solutionArea, technicalCapability, onDealTeam, ...opportunity } = seed
                    void domain; void accountName; void solutionArea; void technicalCapability; void onDealTeam
                    opportunities.push(structuredClone(opportunity))
                }
            }
            return { opportunityId, onDealTeam: true, alreadyMember }
        },
        leaveDealTeam: async (opportunityId) => {
            const alreadyAbsent = !dealTeamOpportunityIds.has(opportunityId)
            dealTeamOpportunityIds.delete(opportunityId)
            return { opportunityId, onDealTeam: false, alreadyAbsent }
        },
        listMilestones: async (opportunityId) => structuredClone(milestones.filter((item) => item.opportunityId === opportunityId)),
        updateMilestone: async (opportunityId, milestoneId, update) => {
            const milestone = milestones.find((item) => item.opportunityId === opportunityId && item.id === milestoneId)
            if (!milestone) throw new Error('Unknown sample milestone.')
            Object.assign(milestone, update, update.customerCommitment !== undefined ? { commitment: update.customerCommitment } : {})
            delete (milestone as Milestone & { customerCommitment?: string }).customerCommitment
            return structuredClone(milestone)
        },
        updateOpportunity: async (opportunityId, update) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            opportunity.comments = update.comments
            return structuredClone(opportunity)
        },
        transitionOpportunityStage: async (accountId, opportunityId, targetStage, reason) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId && item.accountId === accountId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            if (Math.abs(targetStage - opportunity.recordedStage) !== 1) throw new Error('MCEM stage changes must move to an adjacent stage.')
            const previousStage = opportunity.recordedStage
            const evaluation = buildWebEvaluation(opportunity)
            const advancing = targetStage > previousStage
            const hasGaps = evaluation.criteria.some((criterion) => criterion.status !== 'met')
            if ((!advancing || hasGaps) && !reason?.trim()) throw new Error(advancing ? 'An exception reason is required.' : 'A recycle reason is required.')
            const disposition = advancing ? hasGaps ? 'override' : 'advanced' : 'recycled'
            const auditNote = `[MCEM sample transition] Stage ${previousStage} -> Stage ${targetStage}; disposition: ${disposition}.${reason ? ` Reason: ${reason.trim()}` : ''}`
            opportunity.recordedStage = targetStage
            opportunity.comments = [opportunity.comments, auditNote].filter(Boolean).join('\n\n')
            return mcemStageTransitionResultSchema.parse({ opportunity: structuredClone(opportunity), previousStage, targetStage, disposition, auditNote })
        },
        runMcemCoach: async (_accountId, opportunityId) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            return buildWebEvaluation(opportunity)
        },
        runAgentTask: async (capability, _accountId, opportunityId, prompt) => {
            const opportunity = opportunities.find((item) => item.id === opportunityId)
            if (!opportunity) throw new Error('Unknown sample opportunity.')
            const generatedAt = new Date().toISOString()
            return {
                contractVersion,
                correlationId: '20000000-0000-4000-8000-000000000002',
                capability,
                agentVersion: 'web-sample-v1',
                generatedAt,
                mode: 'sample',
                state: 'complete',
                content: `## ${capability.replaceAll('-', ' ')}\n\n**${opportunity.name}** is shown using sanitized web-preview evidence.\n\n> Requested: ${prompt}\n\nOwner-based plan to close gaps\n\n1. ATS — Customer outcomes\n\n- Gap: Missing\n- Evidence: Confirm the accountable role and target date.\n\nRecommended sequence\n\n- Validate the next customer commitment.\n- Record the outcome in MSX after human review.\n\nAssumptions / cautions\n\n- Do not treat internal evidence as customer approval.`,
                sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt }]
            }
        },
        openEmailCompose: createWebApiClient().openEmailCompose,
        exportAgentResponse: createWebApiClient().exportAgentResponse,
        openEvidence: createWebApiClient().openEvidence,
        listWorkflowDefinitions: createWebApiClient().listWorkflowDefinitions,
        startWorkflow: createWebApiClient().startWorkflow,
        getWorkflowRun: createWebApiClient().getWorkflowRun,
        cancelWorkflowRun: createWebApiClient().cancelWorkflowRun,
        listWorkflowRuns: createWebApiClient().listWorkflowRuns,
        prepareWorkflowGuidance: createWebApiClient().prepareWorkflowGuidance
    }
}

function desktopClient(bridge: DesktopBridge): RevampDataClient {
    return {
        mode: 'desktop',
        exitApplication: () => bridge.exitApplication(),
        getCurrentUserEmail: async () => (await bridge.getDataStatus()).auth.userEmail,
        listAccounts: (options) => bridge.listAccounts(options),
        searchAccounts: (request) => bridge.searchAccounts(request),
        addAccount: (accountId) => bridge.addAccount(accountId),
        setAccountVisibility: (accountId, visibility) => bridge.setAccountVisibility(accountId, visibility),
        listOpportunities: (accountId) => bridge.listOpportunities(accountId),
        discoverOpportunities: (domain) => bridge.discoverOpportunities(domain),
        joinDealTeam: (opportunityId) => bridge.joinDealTeam(opportunityId),
        leaveDealTeam: (opportunityId) => bridge.leaveDealTeam(opportunityId),
        listMilestones: (opportunityId) => bridge.listMilestones(opportunityId),
        updateMilestone: (opportunityId, milestoneId, update) => bridge.updateMilestone(opportunityId, milestoneId, update),
        updateOpportunity: (opportunityId, update) => bridge.updateOpportunity(opportunityId, update),
        transitionOpportunityStage: (accountId, opportunityId, targetStage, reason) => bridge.transitionOpportunityStage({ contractVersion, accountId, opportunityId, targetStage, ...(reason === undefined ? {} : { reason }) }),
        runMcemCoach: (accountId, opportunityId) => bridge.runMcemCoach({ contractVersion, accountId, opportunityId, prompt: 'How do we move this opportunity to the next MCEM stage?' }),
        runAgentTask: (capability, accountId, opportunityId, prompt) => bridge.runAgentTask({ contractVersion, capability, accountId, opportunityId, prompt }),
        openEmailCompose: (request) => bridge.openEmailCompose(request),
        exportAgentResponse: (request) => bridge.exportAgentResponse(request),
        openEvidence: (url) => bridge.openEvidence(url),
        listWorkflowDefinitions: async (scope) => workflowDefinitionSchema.array().parse(await bridge.invokeWorkflow('list', { contractVersion, ...(scope ? { scope } : {}) })),
        startWorkflow: async (request) => workflowRunSchema.parse(await bridge.invokeWorkflow('start', request)),
        getWorkflowRun: async (runId) => workflowRunViewSchema.parse(await bridge.invokeWorkflow('get', { contractVersion, runId })),
        cancelWorkflowRun: async (runId) => workflowRunSchema.parse(await bridge.invokeWorkflow('cancel', { contractVersion, runId })),
        listWorkflowRuns: async (scope, limit) => workflowRunSchema.array().parse(await bridge.invokeWorkflow('history', {
            contractVersion,
            ...(scope ? { scope } : {}),
            ...(limit === undefined ? {} : { limit })
        })),
        prepareWorkflowGuidance: async (runId, queueItemId, capability) => workflowGuidanceHandoffSchema.parse(await bridge.invokeWorkflow('guidance', {
            contractVersion, runId, queueItemId, capability
        }))
    }
}

export function createDataClient(shell: 'desktop' | 'web'): RevampDataClient {
    if (shell === 'desktop') {
        if (!window.tlc) throw new Error('The desktop data bridge is unavailable.')
        return desktopClient(window.tlc)
    }
    const hostedMode = document.querySelector<HTMLMetaElement>('meta[name="tlc-data-mode"]')?.content
    if (hostedMode === 'live') return createWebApiClient()
    if (hostedMode === 'sample') return createWebApiClient(fetch, 'web-sample')
    if (window.location.protocol === 'file:') return webClient()
    return webClient()
}

export function stageOwner(stage: number): string {
    return roleByStage[stage - 1] ?? 'Account team'
}