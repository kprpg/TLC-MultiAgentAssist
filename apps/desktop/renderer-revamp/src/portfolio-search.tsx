import { useMemo, useRef, useState } from 'react'
import { Building20Regular, List20Regular, Search20Regular } from '@fluentui/react-icons'
import type { Account, Opportunity } from '../../../../packages/common/index.js'
import { findPortfolioSearchResults, type PortfolioSearchResult } from '../../../shared/portfolio-search.js'
import { createBrowserVoiceProvider } from '../../../shared/browser-voice-provider.js'
import { createHostVoiceProvider } from '../../../shared/host-voice-provider.js'
import { useVoiceDictation } from '../../../shared/use-voice-dictation.js'
import { VoiceSearchControl } from '../../../shared/voice-search-control.js'
import type { RevampDataClient } from './data-client.js'

export function PortfolioSearch({ accounts, opportunities, loading, shell, client, contextKey, onSelect }: {
    accounts: Account[]
    opportunities: Opportunity[]
    loading: boolean
    shell: 'desktop' | 'web'
    client: RevampDataClient
    contextKey: string
    onSelect(result: PortfolioSearchResult<Account, Opportunity>): void
}) {
    const [query, setQuery] = useState('')
    const input = useRef<HTMLInputElement>(null)
    const form = useRef<HTMLFormElement>(null)
    const provider = useMemo(() => shell === 'desktop'
        ? createHostVoiceProvider((request) => client.invokeVoice(request))
        : createBrowserVoiceProvider(), [client, shell])
    const visibleIds = new Set(accounts.filter((account) => account.visibility !== 'hidden').map((account) => account.id))
    const hints = [...new Set([
        ...accounts.filter((account) => visibleIds.has(account.id)).map((account) => account.name),
        ...opportunities.filter((opportunity) => visibleIds.has(opportunity.accountId)).map((opportunity) => opportunity.name)
    ])].filter((name) => name.trim().length > 0 && name.length <= 200).slice(0, 64)
    const voice = useVoiceDictation({ input, form, value: query, onChange: setQuery, provider, hints, contextKey })
    const results = findPortfolioSearchResults(query, accounts, opportunities)
    const expanded = query.trim().length > 0
    const choose = (result: PortfolioSearchResult<Account, Opportunity>) => {
        voice.cancel()
        setQuery('')
        onSelect(result)
    }
    return <form ref={form} className="global-search" role="search" onSubmit={(event) => {
        event.preventDefault()
        if (!voice.active && results[0]) choose(results[0])
    }} onBlur={(event) => voice.blurred(event.relatedTarget)}>
        <Search20Regular />
        <input
            ref={input}
            type="search"
            aria-label="Search accounts and opportunities"
            aria-controls="global-search-results"
            aria-expanded={expanded}
            autoComplete="off"
            placeholder="Search accounts and opportunities"
            value={query}
            onChange={(event) => voice.change(event.target.value)}
            onSelect={voice.selected}
            onKeyDown={(event) => { if (event.key === 'Enter' && voice.active) event.preventDefault() }}
        />
        <VoiceSearchControl voice={voice} />
        {expanded && <div className="search-results" id="global-search-results" role="listbox" aria-label="Search results">
            {results.map((item) => <button
                key={item.type === 'account' ? `account-${item.account.id}` : `opportunity-${item.opportunity.id}`}
                type="button"
                role="option"
                onClick={() => choose(item)}
            >
                {item.type === 'account' ? <Building20Regular /> : <List20Regular />}
                <span>
                    <strong>{item.type === 'account' ? item.account.name : item.opportunity.name}</strong>
                    <small>{item.type === 'account' ? `Account · ${item.account.segment}` : `Opportunity · ${item.account.name}`}</small>
                </span>
            </button>)}
            {!loading && results.length === 0 && <p role="status">No accounts or opportunities found.</p>}
            {loading && <p role="status">Searching portfolio...</p>}
        </div>}
    </form>
}
