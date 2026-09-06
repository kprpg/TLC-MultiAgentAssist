import {
    accountSchema,
    agentTaskResponseSchema,
    contractVersion,
    mcemResponseSchema,
    opportunitySchema,
    type Account,
    type AgentCapability,
    type AgentTaskResponse,
    type EmailComposeRequest,
    type EmailComposeResult,
    type ExportResponseRequest,
    type ExportResponseResult,
    type McemResponse,
    type Opportunity
} from '../../../../packages/common/index.js'

export interface RevampDataClient {
    readonly mode: 'desktop' | 'web-live' | 'web-sample'
    exitApplication(): Promise<void>
    listAccounts(): Promise<Account[]>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    runMcemCoach(accountId: string, opportunityId: string): Promise<McemResponse>
    runAgentTask(capability: AgentCapability, accountId: string, opportunityId: string, prompt: string): Promise<AgentTaskResponse>
    openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
    exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
    openEvidence(url: string): Promise<void>
}

type Fetcher = typeof fetch

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

export function createWebApiClient(fetcher: Fetcher = fetch): RevampDataClient {
    return {
        mode: 'web-live',
        exitApplication: async () => { await apiRequest(fetcher, '/api/exit', { method: 'POST' }) },
        listAccounts: async () => accountSchema.array().parse(await apiRequest(fetcher, '/api/accounts')),
        listOpportunities: async (accountId) => opportunitySchema.array().parse(await apiRequest(fetcher, `/api/accounts/${encodeURIComponent(accountId)}/opportunities`)),
        runMcemCoach: async (accountId, opportunityId) => mcemResponseSchema.parse(await apiRequest(fetcher, '/api/mcem-coach', {
            method: 'POST',
            body: JSON.stringify({ contractVersion, accountId, opportunityId, prompt: 'How do we move this opportunity to the next MCEM stage?' })
        })),
        runAgentTask: async (capability, accountId, opportunityId, prompt) => agentTaskResponseSchema.parse(await apiRequest(fetcher, '/api/agent-task', {
            method: 'POST',
            body: JSON.stringify({ contractVersion, capability, accountId, opportunityId, prompt })
        })),
        openEmailCompose: async (request) => {
            const result = await apiRequest(fetcher, '/api/open-email-compose', { method: 'POST', body: JSON.stringify(request) }) as { state?: unknown; composeUri?: unknown }
            if (result.state !== 'opened' || typeof result.composeUri !== 'string') throw new Error('The web host returned an invalid email compose response.')
            window.location.assign(result.composeUri)
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
            const downloadUrl = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = downloadUrl
            anchor.download = response.headers.get('x-tlc-file-name') || 'TLC-agent-response.docx'
            anchor.click()
            URL.revokeObjectURL(downloadUrl)
            return { state: 'saved', filePath: anchor.download }
        },
        openEvidence: async (url) => { window.open(url, '_blank', 'noopener,noreferrer') }
    }
}

interface DesktopBridge {
    exitApplication(): Promise<void>
    listAccounts(): Promise<Account[]>
    listOpportunities(accountId: string): Promise<Opportunity[]>
    runMcemCoach(request: { contractVersion: typeof contractVersion; accountId: string; opportunityId: string; prompt: string }): Promise<McemResponse>
    runAgentTask(request: { contractVersion: typeof contractVersion; capability: AgentCapability; accountId: string; opportunityId: string; prompt: string }): Promise<AgentTaskResponse>
    openEmailCompose(request: EmailComposeRequest): Promise<EmailComposeResult>
    exportAgentResponse(request: ExportResponseRequest): Promise<ExportResponseResult>
    openEvidence(url: string): Promise<void>
}

declare global {
    interface Window {
        tlc?: DesktopBridge
    }
}

const accounts: Account[] = [
    { id: 'account-contoso', name: 'Contoso Energy', segment: 'Strategic' },
    { id: 'account-fabrikam', name: 'Fabrikam Retail', segment: 'Enterprise' }
]

const opportunities: Opportunity[] = [
    { id: 'opp-grid-modernization', accountId: 'account-contoso', name: 'Grid operations modernization', recordedStage: 3, value: 4200000, currency: 'USD', closeDate: '2026-10-30' },
    { id: 'opp-cloud-security-readiness', accountId: 'account-contoso', name: 'Cloud security readiness', recordedStage: 1, value: 900000, currency: 'USD', closeDate: '2027-02-26' },
    { id: 'opp-data-estate-consolidation', accountId: 'account-contoso', name: 'Data estate consolidation', recordedStage: 2, value: 2650000, currency: 'USD', closeDate: '2027-01-29' },
    { id: 'opp-resilient-cloud-foundation', accountId: 'account-contoso', name: 'Resilient cloud foundation - ready to advance', recordedStage: 1, value: 1450000, currency: 'USD', closeDate: '2027-03-12' },
    { id: 'opp-ai-service', accountId: 'account-fabrikam', name: 'AI-assisted customer service', recordedStage: 2, value: 1750000, currency: 'USD', closeDate: '2026-12-18' },
    { id: 'opp-store-modernization', accountId: 'account-fabrikam', name: 'Connected store modernization', recordedStage: 1, value: 1200000, currency: 'USD', closeDate: '2027-03-19' },
    { id: 'opp-unified-commerce', accountId: 'account-fabrikam', name: 'Unified commerce platform', recordedStage: 3, value: 3800000, currency: 'USD', closeDate: '2026-12-11' },
    { id: 'opp-customer-data-platform', accountId: 'account-fabrikam', name: 'Customer data platform - ready to advance', recordedStage: 2, value: 3200000, currency: 'USD', closeDate: '2027-01-15' }
]

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
        listAccounts: async () => structuredClone(accounts),
        listOpportunities: async (accountId) => structuredClone(opportunities.filter((item) => item.accountId === accountId)),
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
                content: `## ${capability.replaceAll('-', ' ')}\n\n**${opportunity.name}** is shown using sanitized web-preview evidence.\n\n> Requested: ${prompt}\n\n- Validate the next customer commitment.\n- Confirm the accountable role and target date.\n- Record the outcome in MSX after human review.`,
                sourceHealth: [{ source: 'msx', state: 'sample', detail: 'Sanitized static sample.', checkedAt: generatedAt }]
            }
        },
        openEmailCompose: createWebApiClient().openEmailCompose,
        exportAgentResponse: createWebApiClient().exportAgentResponse,
        openEvidence: createWebApiClient().openEvidence
    }
}

function desktopClient(bridge: DesktopBridge): RevampDataClient {
    return {
        mode: 'desktop',
        exitApplication: () => bridge.exitApplication(),
        listAccounts: () => bridge.listAccounts(),
        listOpportunities: (accountId) => bridge.listOpportunities(accountId),
        runMcemCoach: (accountId, opportunityId) => bridge.runMcemCoach({ contractVersion, accountId, opportunityId, prompt: 'How do we move this opportunity to the next MCEM stage?' }),
        runAgentTask: (capability, accountId, opportunityId, prompt) => bridge.runAgentTask({ contractVersion, capability, accountId, opportunityId, prompt }),
        openEmailCompose: (request) => bridge.openEmailCompose(request),
        exportAgentResponse: (request) => bridge.exportAgentResponse(request),
        openEvidence: (url) => bridge.openEvidence(url)
    }
}

export function createDataClient(shell: 'desktop' | 'web'): RevampDataClient {
    if (shell === 'desktop') {
        if (!window.tlc) throw new Error('The desktop data bridge is unavailable.')
        return desktopClient(window.tlc)
    }
    if (document.querySelector<HTMLMetaElement>('meta[name="tlc-data-mode"]')?.content === 'live') {
        return createWebApiClient()
    }
    return webClient()
}

export function stageOwner(stage: number): string {
    return roleByStage[stage - 1] ?? 'Account team'
}