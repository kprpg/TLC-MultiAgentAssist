import { z } from 'zod'
import type { ApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { requireRole, type ExecutionPrincipal } from '../../../packages/orchestrator/collaboration/principal.js'
import { contractVersion } from '../../../packages/common/contracts/version.js'
import { workflowContractVersion } from '../../../packages/common/contracts/workflows.js'
import { agentCapabilitySchema } from '../../../packages/common/contracts/index.js'
import { workflowRunSchema } from '../../../packages/common/contracts/workflows.js'
import { createApplicationOperations } from '../../../packages/orchestrator/operations.js'

export function assertActivityActor(principal: ExecutionPrincipal, actor: { userId?: string | undefined; tenantId?: string | undefined }): void {
  if (actor.userId !== principal.userId || actor.tenantId !== principal.tenantId) throw new Error('The activity actor does not match the delegated API identity.')
}
export async function routeTeamsCommand(
  request: { conversationType: string; text: string; principal: ExecutionPrincipal },
  services: ApplicationServices,
  origin: string
): Promise<{ text: string; openUrl: string }> {
  const destination = new URL(origin)
  if (destination.protocol !== 'https:') throw new Error('Teams conversational links require HTTPS.')
  const handoff = { text: 'Open your private TLC Assist workbench to sign in and review business information or source changes.', openUrl: `${destination.origin}/` }
  if (request.conversationType !== 'personal') return handoff
  requireRole(request.principal, 'TLC.Teams.User')
  const text = z.string().trim().max(1000).parse(request.text)
  const [command, argument, ...remaining] = text.split(/\s+/)
  if (command?.toLowerCase() === 'accounts') {
    const accounts = await services.orchestrator.listAccounts()
    return { text: accounts.length ? `Your accessible accounts:\n${accounts.slice(0, 20).map((account) => account.name).join('\n')}${accounts.length > 20 ? '\nOpen the workbench for the remaining accounts.' : ''}` : 'No accounts are visible in your portfolio.', openUrl: handoff.openUrl }
  }
  if (command?.toLowerCase() === 'workflow' && /^WF-\d{3}$/.test(argument ?? '')) {
    const run = workflowRunSchema.parse(await createApplicationOperations(services).invoke('workflows.start', {
      contractVersion: workflowContractVersion, workflowId: argument, scope: { kind: 'portfolio' },
      input: { asOf: new Date().toISOString().slice(0, 10) }
    }))
    return { text: `Workflow accepted: ${run.runId}. Open the private workbench for progress and source health.`, openUrl: handoff.openUrl }
  }
  if (command?.toLowerCase() === 'status' && argument) {
    const view = services.workflows.get({ contractVersion: workflowContractVersion, runId: argument })
    return { text: `Workflow ${view.run.status}${view.run.state ? ` (${view.run.state})` : ''}.`, openUrl: handoff.openUrl }
  }
  if (command?.toLowerCase() === 'ask') {
    const capability = agentCapabilitySchema.parse(argument)
    const opportunityId = remaining.shift()
    if (!opportunityId || !remaining.length) throw new Error('Use: ask <capability> <opportunity-id> <question>.')
    const snapshot = await services.orchestrator.getOpportunitySnapshot(opportunityId)
    const result = await services.orchestrator.runAgentTask({
      contractVersion, capability, accountId: snapshot.account.id, opportunityId, prompt: remaining.join(' ')
    })
    return { text: `${result.state} guidance:\n${result.content.slice(0, 2500)}\nOpen TLC Assist for complete evidence and source health.`, openUrl: handoff.openUrl }
  }
  return { text: 'Use accounts, workflow WF-001, status <run-id>, or ask <capability> <opportunity-id> <question>. All source changes require private review in TLC Assist.', openUrl: handoff.openUrl }
}
