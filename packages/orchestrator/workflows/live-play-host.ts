import type { DataverseDelegatedScope } from '../../connectors/dataverse-mcp/index.js'
import { createConfiguredWorkflowHost, type ConfiguredWorkflowHost, type ConfiguredWorkflowHostOptions } from './configured-host.js'

/**
 * Rows a single Play may read. The OOB Dataverse MCP `read_query` tool caps each call at 20 rows,
 * so the adapter keyset-paginates up to this ceiling.
 */
export const LIVE_PLAY_ROW_LIMIT = 100

export type LivePlayWorkflowHostOptions =
    Omit<ConfiguredWorkflowHostOptions, 'resolveDelegatedScope' | 'maximumRows'> & {
        /** Returns the signed-in user's Dataverse systemuser id (WhoAmI `UserId`). */
        resolveCurrentUserId(): Promise<string>
        maximumRows?: number
    }

/**
 * Builds a delegated-scope resolver that scopes Dataverse reads to the signed-in user's deal-team
 * portfolio through a `msp_dealteam` JOIN on their user id, which is far cheaper than enumerating
 * the portfolio and injecting a large `IN (...)` predicate. The user id is resolved once and cached.
 */
export function createDealTeamScopeResolver(
    resolveCurrentUserId: () => Promise<string>
): () => Promise<DataverseDelegatedScope> {
    let currentUserId: Promise<string> | undefined
    return async () => {
        currentUserId ??= resolveCurrentUserId().catch((error: unknown) => {
            currentUserId = undefined
            throw error
        })
        return {
            currentUserId: await currentUserId,
            delegatedUserAccountIds: [],
            delegatedUserOpportunityIds: []
        }
    }
}

/** Shared live Play host for Desktop, Web, and the VS Code extension. */
export function createLivePlayWorkflowHost(options: LivePlayWorkflowHostOptions): ConfiguredWorkflowHost {
    const { resolveCurrentUserId, maximumRows, ...configured } = options
    return createConfiguredWorkflowHost({
        ...configured,
        maximumRows: maximumRows ?? LIVE_PLAY_ROW_LIMIT,
        resolveDelegatedScope: createDealTeamScopeResolver(resolveCurrentUserId)
    })
}
