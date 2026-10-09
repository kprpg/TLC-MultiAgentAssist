interface SearchAccount {
    id: string
    name: string
}

interface SearchOpportunity {
    id: string
    accountId: string
    name: string
}

export type PortfolioSearchResult<A, O> =
    | { type: 'account'; account: A }
    | { type: 'opportunity'; account: A; opportunity: O }

export function findPortfolioSearchResults<A extends SearchAccount, O extends SearchOpportunity>(
    query: string,
    accounts: readonly A[],
    opportunities: readonly O[]
): PortfolioSearchResult<A, O>[] {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return []
    const results: PortfolioSearchResult<A, O>[] = accounts
        .filter((account) => account.name.toLocaleLowerCase().includes(normalized))
        .map((account) => ({ type: 'account', account }))
    for (const opportunity of opportunities) {
        if (!opportunity.name.toLocaleLowerCase().includes(normalized)) continue
        const account = accounts.find((item) => item.id === opportunity.accountId)
        if (account) results.push({ type: 'opportunity', account, opportunity })
    }
    return results.slice(0, 8)
}
