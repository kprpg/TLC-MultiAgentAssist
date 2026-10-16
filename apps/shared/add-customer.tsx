import { useId, useRef, useState, type ReactNode } from 'react'
import './add-customer.css'

interface CustomerAccount {
  id: string
  name: string
  segment?: string
  tpid?: string
}

interface CustomerCandidate extends CustomerAccount {
  state: 'not-added' | 'visible' | 'hidden'
}

export interface CustomerSearchClient {
  searchAccounts(request: { query: string; matchBy: 'name' | 'tpid' }): Promise<CustomerCandidate[]>
  addAccount(accountId: string): Promise<CustomerAccount>
  setAccountVisibility(accountId: string, visibility: 'visible'): Promise<CustomerAccount>
}

export function AddCustomerButton({ client, onAdded, className = '', children = 'Add customer' }: {
  client: CustomerSearchClient
  onAdded(account: CustomerAccount): void | Promise<void>
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
  const validQuery = query.trim().length >= (matchBy === 'name' ? 2 : 1)

  function clearResults() {
    setCandidates([])
    setSearched(false)
    setError('')
  }

  function open() {
    setQuery('')
    clearResults()
    dialog.current?.showModal()
  }

  async function search() {
    if (busy || !validQuery) return
    clearResults()
    setBusy('search')
    try {
      setCandidates(await client.searchAccounts({ query: query.trim(), matchBy }))
      setSearched(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search customer accounts.')
    } finally {
      setBusy(null)
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
      dialog.current?.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add customer account.')
    } finally {
      setBusy(null)
    }
  }

  return <>
    <button type="button" className={`customer-search-trigger ${className}`} aria-label="Add customer"
      title="Add customer by name or TPID" aria-haspopup="dialog" aria-controls={id} onClick={open}>{children}</button>
    <dialog ref={dialog} id={id} className="customer-search-dialog" aria-labelledby={`${id}-title`}
      onCancel={(event) => { if (busy) event.preventDefault() }}>
      <h2 id={`${id}-title`}>Add customer account</h2>
      <p>Search customers you can access in MSX, even if you are not on any of their Deal Teams. Adding a customer does not change team membership. Use Add me in Discovery to join an opportunity.</p>
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
          {candidates.map((candidate) => <div className="customer-search-candidate" key={candidate.id}>
            <span><strong>{candidate.name}</strong><small>{[candidate.segment, candidate.tpid ? `TPID ${candidate.tpid}` : undefined].filter(Boolean).join(' - ')}</small></span>
            <button className="customer-search-primary" type="button" disabled={busy !== null || candidate.state === 'visible'} onClick={() => void add(candidate)}>
              {candidate.state === 'visible' ? 'Already added' : candidate.state === 'hidden' ? 'Unhide' : 'Add account'}
            </button>
          </div>)}
          {busy === 'add' && <p role="status">Adding customer...</p>}
        </div>
        <footer><button type="button" disabled={busy !== null} onClick={() => dialog.current?.close()}>Close</button></footer>
      </form>
    </dialog>
  </>
}
