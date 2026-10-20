import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, Textarea } from '@fluentui/react-components'
import { ArrowDownload20Regular, Mic20Regular } from '@fluentui/react-icons'
import { contractVersion, type Milestone, type MeetingChangeSetProposal, type MeetingChangeSetResult, type MeetingTranscriptSummary, type MeetingType } from '../../../../packages/common/index.js'
import type { RevampDataClient } from './data-client.js'
import { readTranscriptFile } from '../../../shared/transcript-file.js'

function toggleSet(previous: ReadonlySet<string>, id: string): Set<string> {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
}

/** Renders a change-set proposal as Markdown for the Word export action. */
function meetingProposalToMarkdown(proposal: MeetingChangeSetProposal, opportunityName: string): string {
    const lines = [`# Meeting signals - ${opportunityName}`, '', `Meeting type: ${proposal.meetingType}`, '', '## Proposed field changes', '', '| Apply | Field | Current | Proposed | MCEM | Confidence |', '| --- | --- | --- | --- | --- | --- |']
    for (const slot of proposal.slots) {
        lines.push(`| ${slot.checkedByDefault && !slot.blocked ? 'yes' : 'review'} | ${slot.label} | ${slot.displayBefore ?? '(empty)'} | ${slot.displayAfter} | ${slot.mcemCriterion} | ${Math.round(slot.confidence * 100)}% |`)
    }
    if (proposal.newMilestones.length > 0) {
        lines.push('', '## New milestones', '')
        for (const milestone of proposal.newMilestones) lines.push(`- ${milestone.name}${milestone.milestoneDate ? ` (${milestone.milestoneDate})` : ''}`)
    }
    if (proposal.unmappedSignals.length > 0) {
        lines.push('', '## Other signals (not injected)', '')
        for (const signal of proposal.unmappedSignals) lines.push(`- ${signal.label}: ${signal.text}`)
    }
    return lines.join('\n')
}

async function readFileIntoContent(event: ChangeEvent<HTMLInputElement>, setContent: (value: string) => void, onNote: (message: string) => void): Promise<void> {
    const file = event.target.files?.[0]
    if (!file) return
    try { setContent((await readTranscriptFile(file)).content) }
    catch (error) { onNote((error as Error).message) }
}

/** Modal approval panel: per-row toggle, milestone multi-select, required reason, all-or-none submit. */
function MeetingReviewModal({ client, proposal, opportunityName, milestones, onClose, onApplied, onNote }: {
    client: RevampDataClient
    proposal: MeetingChangeSetProposal
    opportunityName: string
    milestones: Milestone[]
    onClose: () => void
    onApplied: () => void
    onNote: (message: string) => void
}): ReactElement {
    const [checkedSlots, setCheckedSlots] = useState<Set<string>>(() => new Set(proposal.slots.filter((slot) => slot.checkedByDefault && !slot.blocked).map((slot) => slot.slotId)))
    const [checkedNewMilestones, setCheckedNewMilestones] = useState<Set<string>>(() => new Set(proposal.newMilestones.filter((milestone) => milestone.checkedByDefault).map((milestone) => milestone.tempId)))
    const [selectedMilestones, setSelectedMilestones] = useState<Set<string>>(() => new Set(proposal.suggestedMilestoneIds))
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [result, setResult] = useState<MeetingChangeSetResult | undefined>(undefined)

    const approvedCount = checkedSlots.size + checkedNewMilestones.size
    const canSubmit = approvedCount > 0 && reason.trim().length >= 3 && !busy

    const submit = useCallback(async () => {
        setBusy(true)
        try {
            const applied = await client.applyMeetingChangeSet(proposal, {
                changeSetId: proposal.changeSetId,
                opportunityId: proposal.opportunityId,
                approvedSlotIds: [...checkedSlots],
                approvedNewMilestoneTempIds: [...checkedNewMilestones],
                selectedMilestoneIds: [...selectedMilestones],
                reason: reason.trim()
            })
            setResult(applied)
            onNote(applied.state === 'applied' ? 'Meeting signals injected.' : 'Change set rolled back (a record changed since review).')
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setBusy(false)
        }
    }, [client, proposal, checkedSlots, checkedNewMilestones, selectedMilestones, reason, onNote])

    async function exportWord() {
        setExporting(true)
        try {
            const response = await client.exportAgentResponse({
                contractVersion,
                responseTitle: `Meeting signals - ${opportunityName}`,
                responseMarkdown: meetingProposalToMarkdown(proposal, opportunityName),
                generatedAt: new Date().toISOString()
            })
            onNote(response.state === 'saved' ? 'Word document saved.' : 'Word export was cancelled.')
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setExporting(false)
        }
    }

    return (
        <Dialog open modalType="modal" onOpenChange={(_, data) => { if (!data.open) onClose() }}>
            <DialogSurface className="meeting-modal-surface">
                <DialogBody>
                    <DialogTitle>Review meeting signals</DialogTitle>
                    <DialogContent>
                        <div className="meeting-modal-subhead">
                            <p className="muted">{opportunityName} · {proposal.meetingType} meeting · {proposal.slots.length} proposed change{proposal.slots.length === 1 ? '' : 's'}</p>
                            {!result && <Button appearance="subtle" size="small" icon={<ArrowDownload20Regular />} disabled={exporting} onClick={() => void exportWord()}>{exporting ? 'Exporting...' : 'Export Word'}</Button>}
                        </div>

                        {!result && (<>
                            <table className="record-table meeting-review-table">
                                <thead><tr><th>Apply</th><th>Field</th><th>Current &rarr; Proposed</th><th>MCEM</th><th>Conf.</th></tr></thead>
                                <tbody>
                                    {proposal.slots.map((slot) => (
                                        <tr key={slot.slotId} className={slot.blocked ? 'blocked-row' : ''}>
                                            <td><input type="checkbox" aria-label={`Apply ${slot.label}`} disabled={slot.blocked} checked={checkedSlots.has(slot.slotId)} onChange={() => setCheckedSlots((previous) => toggleSet(previous, slot.slotId))} /></td>
                                            <td>
                                                <strong>{slot.label}</strong>{slot.sensitive && <span className="badge sensitive"> sensitive</span>}
                                                <span className="muted meeting-rationale">{slot.rationale}</span>
                                                {slot.blocked && slot.blockedReason && <span className="error meeting-rationale">{slot.blockedReason}</span>}
                                            </td>
                                            <td><span className="meeting-before">{slot.displayBefore ?? '(empty)'}</span> &rarr; <span className="meeting-after">{slot.displayAfter}</span></td>
                                            <td>{slot.mcemCriterion}</td>
                                            <td>{Math.round(slot.confidence * 100)}%<span className="muted"> · {slot.evidence.length} ref</span></td>
                                        </tr>
                                    ))}
                                    {proposal.slots.length === 0 && <tr><td colSpan={5} className="muted">No field changes detected in this meeting.</td></tr>}
                                </tbody>
                            </table>

                            {proposal.newMilestones.length > 0 && (
                                <section className="meeting-section">
                                    <h4>New milestones</h4>
                                    {proposal.newMilestones.map((milestone) => (
                                        <label key={milestone.tempId} className="meeting-check-row">
                                            <input type="checkbox" checked={checkedNewMilestones.has(milestone.tempId)} onChange={() => setCheckedNewMilestones((previous) => toggleSet(previous, milestone.tempId))} />
                                            <span><strong>{milestone.name}</strong>{milestone.milestoneDate ? ` · ${milestone.milestoneDate}` : ''} · {Math.round(milestone.confidence * 100)}%</span>
                                        </label>
                                    ))}
                                </section>
                            )}

                            {milestones.length > 0 && (
                                <section className="meeting-section">
                                    <h4>Apply milestone changes to</h4>
                                    <p className="muted">Toggle the milestones this meeting updates. Milestone-targeted changes apply only to selected rows.</p>
                                    {milestones.map((milestone) => (
                                        <label key={milestone.id} className="meeting-check-row">
                                            <input type="checkbox" checked={selectedMilestones.has(milestone.id)} onChange={() => setSelectedMilestones((previous) => toggleSet(previous, milestone.id))} />
                                            <span>{milestone.name} <span className="muted">· {milestone.status}</span></span>
                                        </label>
                                    ))}
                                </section>
                            )}

                            {proposal.unmappedSignals.length > 0 && (
                                <section className="meeting-section">
                                    <h4>Other signals (not injected)</h4>
                                    <ul className="item-list">{proposal.unmappedSignals.map((signal, index) => <li key={index}><strong>{signal.label}:</strong> {signal.text}</li>)}</ul>
                                </section>
                            )}

                            <label className="meeting-reason">Reason (required)
                                <Textarea resize="vertical" rows={2} value={reason} onChange={(_, data) => setReason(data.value)} placeholder="Why these updates (min 3 characters)..." />
                            </label>
                        </>)}

                        {result && (
                            <div>
                                <MessageBar intent={result.state === 'applied' ? 'success' : 'error'}>
                                    {result.state === 'applied' ? 'Applied' : 'Rolled back'} — {result.auditNote}
                                </MessageBar>
                                <ul className="item-list meeting-result-list">
                                    {result.items.map((item) => (
                                        <li key={item.id}>{item.state === 'applied' ? '✅' : item.state === 'conflict' ? '⚠' : '🚫'} {item.detail}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </DialogContent>
                    <DialogActions>
                        {!result && <>
                            <span className="muted meeting-selected-count">{approvedCount} selected</span>
                            <Button appearance="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
                            <Button appearance="primary" disabled={!canSubmit} onClick={() => void submit()}>{busy ? 'Submitting...' : 'Submit (all-or-none)'}</Button>
                        </>}
                        {result && <Button appearance="primary" onClick={() => (result.state === 'applied' ? onApplied() : onClose())}>{result.state === 'applied' ? 'Done' : 'Close'}</Button>}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    )
}

/** Meeting-capture launcher shown in the Opportunities blade header (Teams pick or paste/upload). */
export function MeetingCaptureLauncher({ client, opportunityId, opportunityName, milestones, onApplied, onNote }: {
    client: RevampDataClient
    opportunityId: string
    opportunityName: string
    milestones: Milestone[]
    onApplied: () => void
    onNote: (message: string) => void
}): ReactElement {
    const [open, setOpen] = useState(false)
    const [transcripts, setTranscripts] = useState<MeetingTranscriptSummary[]>([])
    const [transcriptId, setTranscriptId] = useState('')
    const [tab, setTab] = useState<'pick' | 'paste'>('pick')
    const [pasteContent, setPasteContent] = useState('')
    const [meetingType, setMeetingType] = useState<MeetingType>('customer')
    const [busy, setBusy] = useState(false)
    const [proposal, setProposal] = useState<MeetingChangeSetProposal | undefined>(undefined)
    const panelRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setOpen(false); setProposal(undefined); setPasteContent(''); setTranscriptId(''); setTab('pick')
        setTranscripts([])
    }, [opportunityId])

    useEffect(() => {
        if (!open || tab !== 'pick') return
        client.listMeetingTranscripts(opportunityId)
            .then((list) => { setTranscripts(list); if (list[0]) setTranscriptId(list[0].id) })
            .catch(() => setTranscripts([]))
    }, [client, opportunityId, open, tab])

    useEffect(() => {
        if (!open) return
        function dismissOutside(event: PointerEvent) {
            if (event.target instanceof Node && !panelRef.current?.contains(event.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', dismissOutside)
        return () => document.removeEventListener('pointerdown', dismissOutside)
    }, [open])

    const canExtract = tab === 'paste' ? pasteContent.trim().length > 10 : transcriptId.length > 0

    const extract = useCallback(async () => {
        setBusy(true)
        try {
            const next = tab === 'paste'
                ? await client.proposeMeetingFromRaw(opportunityId, pasteContent, meetingType)
                : await client.proposeMeetingFromTranscript(opportunityId, transcriptId)
            setProposal(next)
        } catch (error) {
            onNote((error as Error).message)
        } finally {
            setBusy(false)
        }
    }, [client, tab, opportunityId, pasteContent, meetingType, transcriptId, onNote])

    return (
        <div className="meeting-launcher" ref={panelRef}>
            <Button appearance="subtle" className="meeting-launch-button" icon={<Mic20Regular />} aria-expanded={open} onClick={() => setOpen((value) => !value)}>Meeting capture</Button>
            {open && (
                <div className="meeting-launcher-panel">
                    <div className="meeting-launcher-tabs">
                        <button type="button" className={tab === 'pick' ? 'tab active' : 'tab'} onClick={() => setTab('pick')}>Teams meeting</button>
                        <button type="button" className={tab === 'paste' ? 'tab active' : 'tab'} onClick={() => setTab('paste')}>Paste / upload</button>
                    </div>
                    {tab === 'pick' && (transcripts.length > 0 ? (
                        <label className="meeting-field">Meeting
                            <select value={transcriptId} onChange={(event) => setTranscriptId(event.target.value)}>
                                {transcripts.map((transcript) => <option key={transcript.id} value={transcript.id}>{transcript.subject} ({transcript.meetingType}, {transcript.segmentCount} lines)</option>)}
                            </select>
                        </label>
                    ) : <p className="muted">No linked meeting transcripts. Use Paste / upload.</p>)}
                    {tab === 'paste' && (
                        <div className="meeting-paste">
                            <label className="meeting-field">Meeting type
                                <select value={meetingType} onChange={(event) => setMeetingType(event.target.value as MeetingType)}>
                                    <option value="customer">Customer</option>
                                    <option value="internal">Internal</option>
                                </select>
                            </label>
                            <input type="file" accept=".vtt,.txt,text/vtt,text/plain" onChange={(event) => void readFileIntoContent(event, setPasteContent, onNote)} />
                            <textarea rows={4} placeholder="Paste a Teams transcript (WebVTT) or 'Speaker: text' lines..." value={pasteContent} onChange={(event) => setPasteContent(event.target.value)} />
                        </div>
                    )}
                    <div className="actions">
                        <Button appearance="secondary" onClick={() => setOpen(false)}>Close</Button>
                        <Button appearance="primary" disabled={busy || !canExtract} onClick={() => void extract()}>{busy ? 'Extracting...' : 'Extract & Review'}</Button>
                    </div>
                </div>
            )}
            {proposal && (
                <MeetingReviewModal
                    key={proposal.changeSetId}
                    client={client}
                    proposal={proposal}
                    opportunityName={opportunityName}
                    milestones={milestones}
                    onClose={() => setProposal(undefined)}
                    onApplied={() => { setProposal(undefined); setOpen(false); onApplied() }}
                    onNote={onNote}
                />
            )}
        </div>
    )
}
