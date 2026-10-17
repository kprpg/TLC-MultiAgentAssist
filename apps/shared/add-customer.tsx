import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import './add-customer.css'

export interface CustomerAccount {
  id: string
  name: string
  segment?: string
  tpid?: string
}

interface CustomerCandidate extends CustomerAccount {
  state: 'not-added' | 'visible' | 'hidden'
}

export interface CustomerSearchClient {
  getDataMode?(): Promise<'sample' | 'live'>
  searchAccounts(request: { query: string; matchBy: 'name' | 'tpid' }): Promise<CustomerCandidate[]>
  addAccount(accountId: string): Promise<CustomerAccount>
  setAccountVisibility(accountId: string, visibility: 'visible'): Promise<CustomerAccount>
}

export function AddCustomerButton({ client, onAdded, dataMode, className = '', children = 'Add customer' }: {
  client: CustomerSearchClient
  onAdded(account: CustomerAccount): void | Promise<void>
  dataMode?: 'sample' | 'live'
  className?: string
  children?: ReactNode
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [matchBy, setMatchBy] = useState<'name' | 'tpid'>('name')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<CustomerCandidate[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState<'search' | 'add' | null>(null)
  const [error, setError] = useState('')
  const [resolvedMode, setResolvedMode] = useState<'sample' | 'live' | undefined>(undefined)
  const modeRequest = useRef(0)
  const searchRequest = useRef(0)
  const mode = dataMode ?? resolvedMode
  const modeReady = mode !== undefined || !client.getDataMode
  const validQuery = modeReady && query.trim().length >= (matchBy === 'name' ? 2 : 1)

  useEffect(() => {
    modeRequest.current++
    searchRequest.current++
    setCandidates([])
    setSearched(false)
    setError('')
    setBusy(null)
    return () => {
      modeRequest.current++
      searchRequest.current++
    }
  }, [client, dataMode])

  function clearResults() {
    setCandidates([])
    setSearched(false)
    setError('')
  }

  function cancelPending() {
    modeRequest.current++
    searchRequest.current++
    setBusy(null)
  }

  function close() {
    cancelPending()
    dialog.current?.close()
  }

  async function open() {
    cancelPending()
    setQuery('')
    clearResults()
    setResolvedMode(undefined)
    dialog.current?.showModal()
    if (!dataMode && client.getDataMode) {
      const version = ++modeRequest.current
      try {
        const loaded = await client.getDataMode()
        if (version === modeRequest.current && dialog.current?.open) setResolvedMode(loaded)
      } catch (cause) {
        if (version === modeRequest.current && dialog.current?.open) {
          setError(cause instanceof Error ? cause.message : 'Could not determine the search data source. Close and reopen the dialog to retry.')
        }
      }
    }
  }

  async function search() {
    if (busy || !validQuery) return
    clearResults()
    setBusy('search')
    const version = ++searchRequest.current
    try {
      const result = await client.searchAccounts({ query: query.trim(), matchBy })
      if (version === searchRequest.current && dialog.current?.open) {
        setCandidates(result)
        setSearched(true)
      }
    } catch (cause) {
      if (version === searchRequest.current && dialog.current?.open) {
        setError(cause instanceof Error ? cause.message : 'Could not search customer accounts.')
      }
    } finally {
      if (version === searchRequest.current) setBusy(null)
    }
  }

  async function add(candidate: CustomerCandidate) {
    setBusy('add')
    setError('')
    try {
      const account = candidate.state === 'hidden'
        ? await client.setAccountVisibility(candidate.id, 'visible')
        : await client.addAccount(candidate.id)
      await onAdded(account)
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add customer account.')
    } finally {
      setBusy(null)
    }
  }

  return <>
    <button type="button" data-customer-add className={`customer-search-trigger ${className}`} aria-label="Add customer"
      title="Add customer by name or TPID" aria-haspopup="dialog" aria-controls={id} onClick={() => void open()}>{children}</button>
    <dialog ref={dialog} id={id} className="customer-search-dialog" aria-labelledby={`${id}-title`}
      onCancel={(event) => { if (busy === 'add') event.preventDefault(); else cancelPending() }}>
      <h2 id={`${id}-title`}>Add customer account</h2>
      <p>{mode === 'sample' ? 'Sample data only - real MSX customers are not searched.'
        : mode === 'live' ? 'Live MSX - searches use your delegated access.'
          : 'Check your host data mode before searching.'}</p>
      <p>Search accessible existing customers, even if you are not on any of their Deal Teams. Choose the intended account before adding it. Adding a customer does not change team membership. Use Add me in Discovery to join an opportunity; domain filters may leave an added account without matching opportunities.</p>
      <form aria-busy={busy !== null} onSubmit={(event) => { event.preventDefault(); void search() }}>
        <div className="customer-search-modes" role="group" aria-label="Search account by">
          {(['name', 'tpid'] as const).map((mode) => <button key={mode} type="button" aria-pressed={matchBy === mode}
            disabled={busy !== null} onClick={() => { setMatchBy(mode); setQuery(''); clearResults() }}>{mode === 'name' ? 'Account name' : 'TPID'}</button>)}
        </div>
        <label htmlFor={`${id}-query`}>{matchBy === 'name' ? 'Account name' : 'TPID'}</label>
        <div className="customer-search-input">
          <input id={`${id}-query`} autoFocus maxLength={120} value={query} disabled={busy !== null}
            onChange={(event) => { setQuery(event.target.value); clearResults() }} />
          <button className="customer-search-primary" type="submit" disabled={busy !== null || !validQuery}>{busy === 'search' ? 'Searching...' : 'Search'}</button>
        </div>
        {error && <p className="customer-search-error" role="alert">{error}</p>}
        <div className="customer-search-results" aria-live="polite">
          {searched && candidates.length === 0 && <p>No matching customer accounts were found.</p>}
          {searched && matchBy === 'tpid' && candidates.length > 1 && <p role="status">This TPID matches multiple accounts. Choose the intended account; nothing has been added automatically.</p>}
          {searched && candidates.length >= 25 && <p>Showing up to 25 results. Refine your query to find the intended account.</p>}
          {candidates.map((candidate) => <div className="customer-search-candidate" key={candidate.id}>
            <span><strong>{candidate.name}</strong><small>{[candidate.segment, candidate.tpid ? `TPID ${candidate.tpid}` : undefined].filter(Boolean).join(' - ')}</small>
              {matchBy === 'name' && !candidate.name.toLowerCase().includes(query.trim().toLowerCase()) && <small>Suggested match - verify this is the intended customer.</small>}
            </span>
            <button className="customer-search-primary" type="button" disabled={busy !== null || candidate.state === 'visible'} onClick={() => void add(candidate)}>
              {candidate.state === 'visible' ? 'Already added' : candidate.state === 'hidden' ? 'Add again' : 'Add account'}
            </button>
          </div>)}
          {busy === 'add' && <p role="status">Adding customer...</p>}
        </div>
        <footer><button type="button" disabled={busy === 'add'} onClick={close}>Close</button></footer>
      </form>
    </dialog>
  </>
}
