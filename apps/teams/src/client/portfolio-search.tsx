import { useEffect, useRef, useState } from 'react'
import { portfolioIndexSchema, portfolioReadVersion, type Account, type Opportunity } from '../../../../packages/common/contracts/index.js'
import { findPortfolioSearchResults, type PortfolioSearchResult } from '../../../shared/portfolio-search.js'
import type { TeamsApiClient } from './data-client.js'

export function PortfolioSearch({ client, contextKey, onSelect }: {
  client: TeamsApiClient; contextKey: string; onSelect(accountId: string, opportunityId?: string): void
}) {
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    setQuery(''); setAccounts([]); setOpportunities([]); setError(''); setLoading(false)
    return () => request.current?.abort()
  }, [contextKey, client])
  async function load() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError(''); setAccounts([]); setOpportunities([])
    try {
      const current = await client.operation('getPortfolioIndex', { contractVersion: portfolioReadVersion }, portfolioIndexSchema, controller.signal)
      if (!controller.signal.aborted) { setAccounts(current.accounts); setOpportunities(current.opportunities) }
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  useEffect(() => {
    if (query.trim().length < 2) { request.current?.abort(); setAccounts([]); setOpportunities([]); setLoading(false); return }
    const timer = setTimeout(() => { void load() }, 250)
    return () => { clearTimeout(timer); request.current?.abort() }
  }, [query, client])
  const results = findPortfolioSearchResults(query, accounts, opportunities)
  function choose(result: PortfolioSearchResult<Account, Opportunity>) {
    onSelect(result.account.id, result.type === 'opportunity' ? result.opportunity.id : undefined)
    setQuery('')
  }
  return <form role="search" className="portfolio-search" onSubmit={(event) => {
    event.preventDefault()
    const result = results[active]
    if (result) choose(result)
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setQuery('') }}>
    <input type="search" role="combobox" aria-label="Search accounts and opportunities" placeholder="Search accounts and opportunities"
      aria-autocomplete="list" aria-expanded={Boolean(query)} aria-controls="portfolio-search-results"
      aria-activedescendant={query && results[active] ? `portfolio-search-${active}` : undefined}
      value={query} autoComplete="off" onChange={(event) => { setQuery(event.target.value); setActive(0) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setQuery('')
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
          event.preventDefault()
          setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length)
        }
      }} />
    {query && <div className="portfolio-search-results"><div id="portfolio-search-results" role="listbox" aria-label="Search results">
      {results.map((result, index) => <button id={`portfolio-search-${index}`} type="button" role="option" aria-selected={index === active}
        key={`${result.type}:${result.type === 'account' ? result.account.id : result.opportunity.id}`} onClick={() => choose(result)}>
        {result.type === 'account' ? result.account.name : `${result.opportunity.name} - ${result.account.name}`}
      </button>)}
    </div>{loading ? <p role="status">Searching your portfolio...</p> : query.trim().length < 2 ? <p>Type at least two characters to search your current portfolio.</p> : !results.length && !error ? <p>No matching accessible records.</p> : null}
      {error && <p role="alert">{error}</p>}
    </div>}
  </form>
}
