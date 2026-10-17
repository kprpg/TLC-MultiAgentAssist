import { useEffect, useRef, useState, type FormEvent, type InvalidEvent, type ReactElement } from 'react'
import type {
  RecordCreationCatalog,
  RecordCreationDraft,
  RecordCreationPreview,
  RecordCreationResult,
  RecordCreationDraftResult,
  RecordCreationPreviewRequest
} from '../../../packages/common/contracts/record-creation.js'
import {
  buildExistingMilestoneDraft,
  buildOpportunityDraft,
  milestoneRowFromInput,
  newMilestoneRow,
  newOpportunityRow,
  opportunityRowFromInput,
  type MilestoneRow,
  type OpportunityRow
} from './draft-model.js'
import { importCreationCsv, importExistingMilestoneCsv } from './csv.js'
import { CreationPreview } from './creation-preview.js'
import { MilestoneEditor } from './milestone-editor.js'
import { MilestoneGrid } from './milestone-grid.js'
import { OpportunityForm } from './opportunity-form.js'

export type CreationKind = 'opportunity' | 'multiple-opportunities' | 'milestone'

export interface CreationClient {
  listAccounts(): Promise<Array<{ id: string; name: string; visibility?: 'visible' | 'hidden' }>>
  getRecordCreationCatalog(accountId: string): Promise<RecordCreationCatalog>
  previewRecordCreation(target: RecordCreationPreviewRequest['target'], draft: RecordCreationDraft): Promise<RecordCreationPreview>
  commitRecordCreation(preview: RecordCreationPreview): Promise<RecordCreationResult>
  exportRecordCreationDraft(preview: RecordCreationPreview): Promise<RecordCreationDraftResult>
}

const creationTypes: ReadonlyArray<{ kind: CreationKind; label: string; description: string }> = [
  { kind: 'opportunity', label: 'Opportunity', description: 'Create one Opportunity and optional child Milestones for an Account.' },
  { kind: 'multiple-opportunities', label: 'Multiple Opportunities', description: 'Prepare several Opportunities and their Milestones for one Account.' },
  { kind: 'milestone', label: 'Milestone', description: 'Create one or more Milestones under an existing Opportunity.' }
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function downloadFile(file: RecordCreationDraftResult['files'][number]): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function NewWorkspace({
  client,
  onCommitted
}: {
  client: CreationClient
  onCommitted?(accountId: string, opportunityId: string): Promise<void> | void
}): ReactElement {
  const [kind, setKind] = useState<CreationKind | null>(null)
  const [entryMode, setEntryMode] = useState<'form' | 'grid' | 'import'>('form')
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [accountId, setAccountId] = useState('')
  const [parentId, setParentId] = useState('')
  const [catalog, setCatalog] = useState<RecordCreationCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [rows, setRows] = useState<OpportunityRow[]>([newOpportunityRow('opportunity-1')])
  const [milestoneRows, setMilestoneRows] = useState<MilestoneRow[]>([newMilestoneRow('milestone-1')])
  const [target, setTarget] = useState<'sqlite' | 'draft'>('draft')
  const [preview, setPreview] = useState<RecordCreationPreview | null>(null)
  const [result, setResult] = useState<RecordCreationResult | null>(null)
  const [draftFiles, setDraftFiles] = useState<RecordCreationDraftResult['files']>([])
  const [opportunityFile, setOpportunityFile] = useState<File | null>(null)
  const [milestoneFile, setMilestoneFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalidFieldLabel, setInvalidFieldLabel] = useState<string | null>(null)
  const [returnToReview, setReturnToReview] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const invalidControl = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null)
  const firstInvalid = useRef(false)
  const keySequence = useRef(1)
  const nextKey = (prefix: string) => {
    let candidate = `${prefix}-${++keySequence.current}`
    while (rows.some((row) => row.key === candidate || row.milestones.some((item) => item.key === candidate))
      || milestoneRows.some((row) => row.key === candidate)) {
      candidate = `${prefix}-${++keySequence.current}`
    }
    return candidate
  }

  useEffect(() => {
    let active = true
    client.listAccounts()
      .then((items) => { if (active) setAccounts(items.filter((item) => item.visibility !== 'hidden')) })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [client])

  useEffect(() => {
    if (!accountId) {
      setCatalog(null)
      return
    }
    let active = true
    setCatalog(null)
    setCatalogLoading(true)
    setError('')
    client.getRecordCreationCatalog(accountId)
      .then((loaded) => {
        if (!active) return
        setCatalog(loaded)
        setTarget(loaded.target)
        setRows((current) => current.map((row) => ({
          ...row,
          priceListId: row.priceListId || loaded.defaults.priceList?.id || '',
          currencyId: row.currencyId || loaded.defaults.currency?.id || '',
          ownerId: row.ownerId || loaded.defaults.owner.id,
          milestones: row.milestones.map((milestone) => ({
            ...milestone,
            ownerId: milestone.ownerId || loaded.defaults.owner.id,
            statusValue: milestone.statusValue || String(loaded.choices.status.find((item) => item.value === 861980000)?.value ?? '')
          }))
        })))
        setMilestoneRows((current) => current.map((row) => ({
          ...row,
          ownerId: row.ownerId || loaded.defaults.owner.id,
          statusValue: row.statusValue || String(loaded.choices.status.find((item) => item.value === 861980000)?.value ?? '')
        })))
      })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setCatalogLoading(false) })
    return () => { active = false }
  }, [accountId, client])

  useEffect(() => {
    if (error && !invalidFieldLabel) errorRef.current?.focus()
  }, [error, invalidFieldLabel])

  useEffect(() => {
    if (returnToReview && !preview) {
      reviewButtonRef.current?.focus()
      setReturnToReview(false)
    }
  }, [preview, returnToReview])

  function onInvalid(event: InvalidEvent<HTMLFormElement>): void {
    if (firstInvalid.current) return
    const field = event.target
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return
    firstInvalid.current = true
    if (invalidControl.current) invalidControl.current.removeAttribute('id')
    invalidControl.current = field
    field.id = 'new-record-invalid-field'
    const label = field.getAttribute('aria-label') ?? field.labels?.[0]?.firstChild?.textContent?.trim() ?? 'required field'
    setInvalidFieldLabel(label)
    setError(`Complete ${label} before reviewing.`)
  }

  function submitReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (entryMode === 'import') {
      setError('Import the selected CSV before reviewing records.')
      return
    }
    void review()
  }

  function chooseAccount(id: string): void {
    setAccountId(id)
    setParentId('')
    setRows([newOpportunityRow(nextKey('opportunity'))])
    setMilestoneRows([newMilestoneRow(nextKey('milestone'))])
    setPreview(null)
    setResult(null)
    setDraftFiles([])
    setOpportunityFile(null)
    setMilestoneFile(null)
    setError('')
    setInvalidFieldLabel(null)
  }

  function changeKind(next: CreationKind): void {
    setKind(next)
    setEntryMode('form')
    setPreview(null)
    setResult(null)
    setDraftFiles([])
    setOpportunityFile(null)
    setMilestoneFile(null)
    setError('')
    setInvalidFieldLabel(null)
  }

  function updateRow(updated: OpportunityRow): void {
    setRows((current) => current.map((item) => item.key === updated.key ? updated : item))
    setPreview(null)
    setResult(null)
  }

  function duplicateRow(row: OpportunityRow, index: number): void {
    const copy = {
      ...row,
      key: nextKey('opportunity'),
      milestones: row.milestones.map((item) => ({ ...item, key: nextKey('milestone') }))
    }
    setRows((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)])
    setPreview(null)
    setResult(null)
  }

  function updateMilestone(updated: MilestoneRow): void {
    setMilestoneRows((current) => current.map((item) => item.key === updated.key ? updated : item))
    setPreview(null)
    setResult(null)
  }

  async function importFiles(): Promise<void> {
    if (!catalog) return
    setError('')
    setBusy(true)
    try {
      if (kind === 'milestone') {
        if (!milestoneFile) throw new Error('Select a Milestone CSV file.')
        const parent = catalog.opportunities.find((item) => item.id === parentId)
        if (!parent) throw new Error('Select an existing parent Opportunity.')
        const draft = importExistingMilestoneCsv(catalog, parent, await milestoneFile.text())
        if (draft.kind !== 'existing-opportunity-milestone-batch') throw new Error('The CSV contained the wrong record type.')
        setMilestoneRows(draft.milestones.map(milestoneRowFromInput))
        setEntryMode('form')
      } else {
        if (!opportunityFile) throw new Error('Select an Opportunity CSV file.')
        const draft = importCreationCsv(catalog, await opportunityFile.text(), milestoneFile ? await milestoneFile.text() : undefined)
        if (draft.kind !== 'opportunity-batch') throw new Error('The CSV contained the wrong record type.')
        setRows(draft.opportunities.map((bundle) => opportunityRowFromInput(bundle.opportunity, bundle.milestones)))
        setEntryMode('grid')
      }
      setPreview(null)
      setResult(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function review(): Promise<void> {
    if (!catalog || !kind) return
    setBusy(true)
    setError('')
    try {
      const draft = kind === 'milestone'
        ? buildExistingMilestoneDraft(catalog, catalog.opportunities.find((item) => item.id === parentId) ?? { id: '', label: '' }, milestoneRows)
        : buildOpportunityDraft(catalog, kind === 'opportunity' ? rows.slice(0, 1) : rows)
      setPreview(await client.previewRecordCreation(target, draft))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      if (preview.target === 'sqlite') {
        setResult(await client.commitRecordCreation(preview))
      } else {
        const draft = await client.exportRecordCreationDraft(preview)
        setResult(draft.result)
        setDraftFiles(draft.files)
      }
      setPreview(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function viewInPortfolio(): Promise<void> {
    if (!result || !onCommitted) return
    const created = result.created.find((item) => item.kind === 'opportunity')?.recordId
      ?? (catalog?.opportunities.find((item) => item.id === parentId)?.id)
    if (!created) {
      setError('The created Opportunity could not be found in the result.')
      return
    }
    try {
      await onCommitted(accountId, created)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <section className="new-record-workspace" aria-label="New record creation">
      <form className="new-record-content" onSubmit={submitReview} onInvalid={onInvalid}>
        <h1>New</h1>
        <p>Enter records in a form or import CSV, then validate and review. SQLite sample mode can save the reviewed batch; live mode only exports a draft.</p>
        <div className="new-record-types" aria-label="Creation type">
          {creationTypes.map((type) => (
            <button key={type.kind} type="button" className={kind === type.kind ? 'new-record-type selected' : 'new-record-type'} onClick={() => changeKind(type.kind)} aria-label={type.label} aria-pressed={kind === type.kind}>
              <strong>{type.label}</strong>
              <span>{type.description}</span>
            </button>
          ))}
        </div>
        {error && <p id="new-record-error" ref={errorRef} role="alert" tabIndex={-1} className="new-record-error">
          {error}
          {invalidFieldLabel && <> <a href="#new-record-invalid-field">Go to {invalidFieldLabel}</a></>}
        </p>}

        {kind && <>
          <div className="new-record-fields new-record-context">
            <label>Account
              <select required value={accountId} onChange={(event) => chooseAccount(event.target.value)}>
                <option value="">Select Account</option>
                {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {kind === 'milestone' && <label>Parent Opportunity
              <select required value={parentId} onChange={(event) => { setParentId(event.target.value); setPreview(null); setResult(null) }} disabled={!catalog}>
                <option value="">Select parent Opportunity</option>
                {catalog?.opportunities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>}
          </div>
          {catalogLoading && <p>Loading creation catalog...</p>}
          {catalog && <p className="new-record-target">
            {target === 'sqlite' ? <strong>SQLite sample store</strong> : <strong>Draft only - MSX creation is disabled</strong>}
            <br />
            {target === 'sqlite'
              ? 'Importing a CSV only fills the draft. Submit to SQLite after validation and review to save records.'
              : 'Exporting a draft does not create records in SQLite or MSX.'}
          </p>}
          {catalog?.target === 'sqlite' && <label className="new-record-target-select">Save target
            <select value={target} onChange={(event) => { setTarget(event.target.value as 'sqlite' | 'draft'); setPreview(null); setResult(null) }}>
              <option value="sqlite">SQLite sample store</option>
              <option value="draft">Draft only</option>
            </select>
          </label>}

          {!result && !preview && <>
            {kind === 'multiple-opportunities' && <div className="new-record-mode" role="group" aria-label="Entry mode">
              <button type="button" aria-pressed={entryMode === 'form'} onClick={() => setEntryMode('form')}>Form</button>
              <button type="button" aria-pressed={entryMode === 'grid'} onClick={() => setEntryMode('grid')}>Grid</button>
              <button type="button" aria-pressed={entryMode === 'import'} onClick={() => setEntryMode('import')}>Import CSV</button>
            </div>}
            {kind === 'milestone' && <div className="new-record-mode" role="group" aria-label="Entry mode">
              <button type="button" aria-pressed={entryMode === 'form'} onClick={() => setEntryMode('form')}>Form</button>
              <button type="button" aria-pressed={entryMode === 'grid'} onClick={() => setEntryMode('grid')}>Grid</button>
              <button type="button" aria-pressed={entryMode === 'import'} onClick={() => setEntryMode('import')}>Import CSV</button>
            </div>}
            {entryMode === 'import' && kind !== 'opportunity' ? <div key={`${accountId}-${kind}`} className="new-record-import">
              <p>Import validates and loads rows for review; it does not save to SQLite.
                {target === 'sqlite' ? ' Validate & review, then Submit to SQLite to create the records.' : ' Validate & review, then export a no-write draft.'}
              </p>
              {kind === 'milestone' && <p>Omit parentOpportunityKey from an existing-parent Milestone CSV. All rows use the selected parent.</p>}
              {kind !== 'milestone' && <label>Opportunities CSV<input type="file" accept=".csv,text/csv" onChange={(event) => setOpportunityFile(event.target.files?.[0] ?? null)} /></label>}
              <label>Milestones CSV<input type="file" accept=".csv,text/csv" onChange={(event) => setMilestoneFile(event.target.files?.[0] ?? null)} /></label>
              <button type="button" disabled={!catalog || busy} onClick={() => void importFiles()}>Validate & load CSV</button>
            </div> : kind === 'milestone' && entryMode === 'grid' ? <MilestoneGrid
              rows={milestoneRows}
              catalog={catalog}
              onChange={updateMilestone}
              onAdd={() => setMilestoneRows((current) => [...current, newMilestoneRow(nextKey('milestone'), catalog ?? undefined)])}
              onEdit={() => setEntryMode('form')}
              onRemove={(key) => setMilestoneRows((current) => current.filter((item) => item.key !== key))}
            /> : kind === 'milestone' ? <>
              {milestoneRows.map((row) => <MilestoneEditor
                key={row.key}
                row={row}
                catalog={catalog}
                onChange={updateMilestone}
                {...(milestoneRows.length > 1 ? {
                  onRemove: () => setMilestoneRows((current) => current.filter((item) => item.key !== row.key))
                } : {})}
              />)}
              <button type="button" onClick={() => setMilestoneRows((current) => [...current, newMilestoneRow(nextKey('milestone'), catalog ?? undefined)])}>Add Milestone</button>
            </> : entryMode === 'grid' && kind === 'multiple-opportunities' ? <>
              <div className="new-record-grid-wrap"><table className="new-record-grid">
                <thead><tr><th>Opportunity name</th><th>Estimated value</th><th>Estimated close date</th><th>Actions</th></tr></thead>
                <tbody>{rows.map((row, index) => <tr key={row.key}>
                  <td><input required aria-label="Opportunity name" value={row.name} onChange={(event) => updateRow({ ...row, name: event.target.value })} /></td>
                  <td><input required aria-label="Estimated value" type="number" min={0} step="0.0001" value={row.estimatedValue} onChange={(event) => updateRow({ ...row, estimatedValue: event.target.value })} /></td>
                  <td><input required aria-label="Estimated close date" type="date" value={row.estimatedCloseDate} onChange={(event) => updateRow({ ...row, estimatedCloseDate: event.target.value })} /></td>
                  <td>
                    <button type="button" onClick={() => setEntryMode('form')}>Edit details</button>
                    <button type="button" onClick={() => duplicateRow(row, index)}>Duplicate Opportunity</button>
                    <button type="button" disabled={rows.length === 1} onClick={() =>
                      setRows((current) => current.filter((item) => item.key !== row.key))}>Remove Opportunity</button>
                  </td>
                </tr>)}</tbody>
              </table></div>
              <button type="button" onClick={() => setRows((current) => [...current, newOpportunityRow(nextKey('opportunity'), catalog ?? undefined)])}>Add Opportunity</button>
            </> : <>
              {(kind === 'opportunity' ? rows.slice(0, 1) : rows).map((row) => <OpportunityForm
                key={row.key}
                row={row}
                catalog={catalog}
                onChange={updateRow}
                onAddMilestone={() => updateRow({ ...row, milestones: [...row.milestones, newMilestoneRow(nextKey('milestone'), catalog ?? undefined)] })}
                {...(kind === 'multiple-opportunities' && rows.length > 1 ? {
                  onRemove: () => setRows((current) => current.filter((item) => item.key !== row.key))
                } : {})}
              />)}
              {kind === 'multiple-opportunities' && <button type="button" onClick={() => setRows((current) => [...current, newOpportunityRow(nextKey('opportunity'), catalog ?? undefined)])}>Add another Opportunity</button>}
            </>}
            <div className="new-record-actions">
              <button
                ref={reviewButtonRef}
                type="submit"
                disabled={!catalog || busy || entryMode === 'import'}
                onClick={() => { firstInvalid.current = false; setError(''); setInvalidFieldLabel(null) }}
              >Validate & review</button>
            </div>
          </>}

          {preview && !result && catalog && <CreationPreview
            preview={preview}
            catalog={catalog}
            busy={busy}
            onEdit={() => { setPreview(null); setReturnToReview(true) }}
            onConfirm={() => void confirm()}
          />}

          {result && <div className="new-record-review">
            <h2>{result.state === 'drafted' ? 'Draft ready' : 'Creation result'}</h2>
            <p role="status">{result.message}</p>
            <p>{result.audit.opportunityCount} Opportunities, {result.audit.milestoneCount} Milestones.</p>
            {draftFiles.length > 0 && <ul>{draftFiles.map((file) => <li key={file.name}><button type="button" onClick={() => downloadFile(file)}>Download {file.name}</button></li>)}</ul>}
            <div className="new-record-actions">
              {result.state === 'committed' && onCommitted && <button type="button" onClick={() => void viewInPortfolio()}>View in Portfolio</button>}
              <button type="button" onClick={() => { setResult(null); setDraftFiles([]) }}>New batch</button>
            </div>
          </div>}
        </>}
      </form>
    </section>
  )
}
