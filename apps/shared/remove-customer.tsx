import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { CustomerAccount } from './add-customer.js'
import './add-customer.css'
import './remove-customer.css'

interface RemovableCustomer extends CustomerAccount {
  visibility?: 'visible' | 'hidden' | undefined
}

export interface CustomerRemovalClient {
  listAccounts(): Promise<RemovableCustomer[]>
  setAccountVisibility(accountId: string, visibility: 'hidden'): Promise<CustomerAccount>
}

export function RemoveCustomerButton({ client, onRemoved, account, className = '', children }: {
  client: CustomerRemovalClient
  onRemoved(account: CustomerAccount): void | Promise<void>
  account?: CustomerAccount
  className?: string
  children?: ReactNode
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const request = useRef(0)
  const submitting = useRef(false)
  const savedRemoval = useRef(false)
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [selected, setSelected] = useState<CustomerAccount | undefined>(account)
  const [busy, setBusy] = useState<'load' | 'remove' | null>(null)
  const [error, setError] = useState('')
  const [removed, setRemoved] = useState(false)

  useEffect(() => {
    request.current++
    submitting.current = false
    setBusy(null)
    dialog.current?.close()
    return () => {
      request.current++
      if (savedRemoval.current) document.querySelector<HTMLButtonElement>('[data-customer-add]')?.focus()
    }
  }, [client, account?.id])

  useEffect(() => {
    if (removed && busy === null && !dialog.current?.open) trigger.current?.focus()
  }, [removed, busy])

  function close() {
    request.current++
    setBusy(null)
    dialog.current?.close()
  }

  async function open() {
    const version = ++request.current
    setAccounts([])
    setSelected(account)
    setRemoved(false)
    savedRemoval.current = false
    setError('')
    setBusy('load')
    dialog.current?.showModal()
    try {
      const visible = (await client.listAccounts()).filter((item) => item.visibility !== 'hidden')
      if (version !== request.current) return
      setAccounts(visible)
      if (account) {
        const current = visible.find((item) => item.id === account.id)
        setSelected(current)
        if (!current) setError('This customer is no longer in your tracked portfolio. Close and refresh the view.')
      }
    } catch (cause) {
      if (version === request.current) {
        setSelected(undefined)
        setError(cause instanceof Error ? cause.message : 'Could not load tracked customers. Close and reopen to retry.')
      }
    } finally {
      if (version === request.current) setBusy(null)
    }
  }

  async function remove() {
    if (!selected || busy || removed || submitting.current) return
    const customer = selected
    const version = request.current
    submitting.current = true
    setBusy('remove')
    setError('')
    let saved = false
    try {
      await client.setAccountVisibility(customer.id, 'hidden')
      saved = true
      if (version !== request.current) return
      savedRemoval.current = true
      setRemoved(true)
      // The owner may unmount the account row as soon as it is notified.
      dialog.current?.close()
      await onRemoved(customer)
      close()
    } catch (cause) {
      if (version === request.current) {
        const detail = cause instanceof Error ? cause.message : 'The request could not be completed.'
        setError(saved ? `Customer removed, but TLC could not refresh its working views. ${detail} Close and refresh the view.` : `Could not remove customer. ${detail}`)
        if (saved && !dialog.current?.open) dialog.current?.showModal()
      }
    } finally {
      submitting.current = false
      if (version === request.current) setBusy(null)
    }
  }

  return <>
    <button ref={trigger} type="button" className={`customer-search-trigger customer-remove-trigger ${className}`}
      aria-label={account ? 'Remove this customer' : 'Remove customer'} title={account ? `Remove ${account.name} from this TLC portfolio` : 'Remove customer from this TLC portfolio'}
      aria-haspopup="dialog" aria-controls={id} disabled={busy === 'remove'} onClick={() => void open()}>{children ?? (account ? 'Remove' : 'Remove customer')}</button>
    <dialog ref={dialog} id={id} className="customer-search-dialog customer-remove-dialog" aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!submitting.current) close() }}>
      <h2 id={`${id}-title`}>Remove customer account</h2>
      <p id={`${id}-description`}>This removes the customer from this app/profile's Portfolio, Discovery, search, New account selectors, and future Plays. MSX/Dataverse records and team membership will not change. Saved Play runs and the official Seller Dashboard are unchanged. Use Add customer to add it again.</p>
      {!account && <>
        <label htmlFor={`${id}-account`}>Choose a tracked customer</label>
        <select id={`${id}-account`} className="customer-remove-select" value={selected?.id ?? ''} disabled={busy !== null || removed}
          onChange={(event) => { setSelected(accounts.find((item) => item.id === event.target.value)); setError('') }}>
          <option value="">Select a customer</option>
          {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.tpid ? ` - TPID ${item.tpid}` : ''}</option>)}
        </select>
      </>}
      {busy === 'load' && <p role="status">Loading tracked customers...</p>}
      {!busy && !error && accounts.length === 0 && <p>No customers to remove. Use Add customer to track a customer first.</p>}
      {selected && <p>Remove <strong>{selected.name}</strong>{selected.tpid ? ` (TPID ${selected.tpid})` : ''} from this TLC portfolio?</p>}
      {error && <p className="customer-search-error" role="alert">{error}</p>}
      {busy === 'remove' && <p role="status">Removing customer...</p>}
      <footer>
        <button type="button" autoFocus disabled={busy === 'remove'} onClick={close}>{removed ? 'Close' : 'Cancel'}</button>
        <button type="button" className="customer-remove-confirm" disabled={!selected || busy !== null || removed} onClick={() => void remove()}>Remove customer</button>
      </footer>
    </dialog>
  </>
}
