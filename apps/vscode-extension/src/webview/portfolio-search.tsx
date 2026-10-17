import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { findPortfolioSearchResults, type PortfolioSearchResult } from '../../../shared/portfolio-search.js'
import { dataClient } from './data-client.js'
import type { AccountView, OpportunityView } from './view-types.js'
import { createHostVoiceProvider } from '../../../shared/host-voice-provider.js'
import { useVoiceDictation } from '../../../shared/use-voice-dictation.js'
import { VoiceSearchControl } from '../../../shared/voice-search-control.js'

export interface PortfolioSearchTarget {
    accountId: string
    opportunityId?: string
}

export function PortfolioSearch({ onSelect, contextKey = '' }: {
    onSelect(target: PortfolioSearchTarget): void
    contextKey?: string
}): ReactElement {
    const [query, setQuery] = useState('')
    const [accounts, setAccounts] = useState<AccountView[]>([])
    const [opportunities, setOpportunities] = useState<OpportunityView[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const requestId = useRef(0)
    const input = useRef<HTMLInputElement>(null)
    const form = useRef<HTMLFormElement>(null)
    const provider = useMemo(() => createHostVoiceProvider((request) => dataClient.invokeVoice(request)), [])
    const hints = [...new Set([...accounts.map((account) => account.name), ...opportunities.map((opportunity) => opportunity.name)])]
        .filter((name) => name.trim().length > 0 && name.length <= 200).slice(0, 64)
    const voice = useVoiceDictation({ input, form, value: query, onChange: setQuery, provider, hints, contextKey })

    useEffect(() => () => { requestId.current += 1 }, [])

    useEffect(() => {
        requestId.current++
        setQuery('')
        setAccounts([])
        setOpportunities([])
        setLoading(false)
        setError('')
    }, [contextKey])

    async function refreshPortfolio() {
        const id = ++requestId.current
        setLoading(true)
        setError('')
        setAccounts([])
        setOpportunities([])
        try {
            const items = (await dataClient.listAccounts()).filter((account) => account.visibility !== 'hidden')
            const portfolio = await Promise.all(items.map((account) => dataClient.listOpportunities(account.id)))
            if (id !== requestId.current) return
            setAccounts(items)
            setOpportunities(portfolio.flat())
        } catch (cause) {
            if (id === requestId.current) setError(cause instanceof Error ? cause.message : 'Could not load portfolio search.')
        } finally {
            if (id === requestId.current) setLoading(false)
        }
    }

    const results = findPortfolioSearchResults(query, accounts, opportunities)
    const expanded = query.trim().length > 0

    function choose(result: PortfolioSearchResult<AccountView, OpportunityView>) {
        voice.cancel()
        setQuery('')
        onSelect({
            accountId: result.account.id,
            ...(result.type === 'opportunity' ? { opportunityId: result.opportunity.id } : {})
        })
    }

    return (
        <form ref={form} className="portfolio-search" role="search" onSubmit={(event) => {
            event.preventDefault()
            if (!voice.active && results[0]) choose(results[0])
        }} onBlur={(event) => {
            voice.blurred(event.relatedTarget)
            if (!event.currentTarget.contains(event.relatedTarget)) setQuery('')
        }}>
            <input
                ref={input}
                type="search"
                aria-label="Search accounts and opportunities"
                aria-controls="portfolio-search-results"
                aria-expanded={expanded}
                autoComplete="off"
                placeholder="Search accounts and opportunities"
                value={query}
                onFocus={() => void refreshPortfolio()}
                onChange={(event) => voice.change(event.target.value)}
                onSelect={voice.selected}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && voice.active) event.preventDefault()
                    if (event.key === 'Escape') setQuery('')
                }}
            />
            <VoiceSearchControl voice={voice} />
            {expanded && <div className="portfolio-search-results" id="portfolio-search-results" role="listbox" aria-label="Search results">
                {results.map((result) => <button
                    key={result.type === 'account' ? `account-${result.account.id}` : `opportunity-${result.opportunity.id}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => choose(result)}
                >
                    <strong>{result.type === 'account' ? result.account.name : result.opportunity.name}</strong>
                    <small>{result.type === 'account' ? `Account${result.account.segment ? ` · ${result.account.segment}` : ''}` : `Opportunity · ${result.account.name}`}</small>
                </button>)}
                {loading && <p role="status">Searching portfolio...</p>}
                {error && <p role="alert">{error}</p>}
                {!loading && !error && results.length === 0 && <p role="status">No accounts or opportunities found.</p>}
            </div>}
        </form>
    )
}
