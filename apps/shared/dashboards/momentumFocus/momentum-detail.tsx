import { useEffect, useRef, useState } from 'react'
import type { MomentumPriority } from '../../../../packages/common/contracts/momentum-focus.js'
import { momentumTierLabels, momentumValue } from './momentum-format.js'

export type OpenMomentumPortfolio = (accountId: string, opportunityId: string) => void | Promise<void>
export function MomentumDetail({ item, onClose, onOpenPortfolio }: {
    item: MomentumPriority
    onClose(): void
    onOpenPortfolio?: OpenMomentumPortfolio | undefined
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const [error, setError] = useState('')
    useEffect(() => {
        const previous = document.activeElement
        const element = dialog.current
        element?.showModal()
        return () => {
            element?.close()
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
        }
    }, [])
    const openPortfolio = async () => {
        if (!onOpenPortfolio || !item.accountId) return
        try { await onOpenPortfolio(item.accountId, item.opportunityId); onClose() } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'The source record could not be opened in Portfolio.')
        }
    }
    return <dialog ref={dialog} className="momentum-detail" aria-labelledby="momentum-detail-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
        <header><h2 id="momentum-detail-title">Why this item?</h2><button type="button" onClick={onClose} autoFocus>Close details</button></header>
        <h3>{item.name}</h3>
        <p>{item.accountName ?? 'Unknown account'} / {item.entity} / {momentumTierLabels[item.tier]}</p>
        <dl className="momentum-facts">
            <dt>Stage / status</dt><dd>{item.stage ?? 'Unknown'} / {item.status ?? 'Unknown'}</dd>
            <dt>Recorded activity state</dt><dd>{item.active === null ? 'Unknown - verify' : item.active ? 'Active' : 'Not active'}</dd>
            <dt>Recorded deadline</dt><dd>{item.dueDate ?? 'Unknown'}</dd>
            {item.reviewDate && <><dt>Suggested review</dt><dd>{item.reviewDate} (proposed, not a CRM deadline)</dd></>}
            <dt>Value and unit</dt><dd>{momentumValue(item.value)}</dd>
            <dt>Accountable role / proposed handoff</dt><dd>{item.accountableRole}; verified owner: {item.ownerName ?? item.ownerId ?? 'Unknown'}</dd>
            <dt>Evidence quality</dt><dd>{item.sourceQuality}; {item.historyCoverage} history window; progress {item.progressCount ?? 'Unknown'}, dated signals {item.signalCount ?? 'Unknown'}</dd>
            <dt>Signal breadth / recency</dt><dd>{item.signalTypes.length} dated types: {item.signalTypes.join(', ') || 'None observed'}; latest {item.latestSignal ?? 'Unknown'}</dd>
            <dt>Latest qualified movement</dt><dd>{item.latestProgress ?? 'Unknown / none in the selected evidence window'}</dd>
            {item.blockingMilestoneIds.length > 0 && <><dt>Linked blocker references</dt><dd>{item.blockingMilestoneIds.join(', ')}</dd></>}
            <dt>History available since</dt><dd>{item.history.availableSince ?? 'Not available'}</dd>
            <dt>History scope / coverage</dt><dd>{item.history.scope}; {item.history.state}; {item.history.observations} observations; longest capture gap {item.history.maxGapDays?.toFixed(1) ?? 'Unknown'} days</dd>
        </dl>
        <p>Refresh capture is not continuous monitoring. No observed progress does not mean no work occurred.</p>
        <h3>Priority drivers</h3><ul>{item.reasons.map((reason) => <li key={reason.code}>{reason.text}</li>)}</ul>
        <h3>Suggested next step</h3><p>{item.nextAction}</p>
        <h3>Evidence timeline and references</h3>
        {item.events.length === 0 ? <p>No dated source events are available. No history was fabricated from current fields.</p> : <ol className="momentum-timeline">{item.events.map((event) => <li key={`${event.source}:${event.id}`}>
            <strong>{event.kind.replaceAll('-', ' ')}</strong> ({event.source})
            <p>{event.sourceAt ? `Recorded event time: ${event.sourceAt}` : `Observed between ${event.intervalStart ?? 'Unknown'} and ${event.intervalEnd ?? 'Unknown'}; precise occurrence time unknown.`}</p>
            <p>Observed/ingested: {event.observedAt}. Reference: {event.id}</p>
            {event.relatedRecordKey && <p>Qualified linked outcome: {event.relatedRecordKey}</p>}
            {event.field && <p>{event.field}: {event.from ?? 'Unknown'} to {event.to ?? 'Unknown'}</p>}
        </li>)}</ol>}
        <div className="momentum-detail-actions">
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Open MSX</a>}
            {onOpenPortfolio && item.accountId && item.history.scope !== 'synthetic' && <button type="button" onClick={() => void openPortfolio()}>Open Portfolio / advisory workflows</button>}
            {item.history.scope === 'synthetic' && <p>Synthetic fixture only; no live CRM record link or write action.</p>}
        </div>
        {error && <p role="alert">{error}</p>}
    </dialog>
}
