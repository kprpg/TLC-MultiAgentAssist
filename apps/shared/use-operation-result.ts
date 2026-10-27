import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { OperationKind, OperationResultSession, OperationScope } from './operation-result-session.js'
import { meetingChangeSetProposalSchema, type MeetingChangeSetProposal, type MeetingType } from '../../packages/common/contracts/meeting.js'
import { meetingListFailure } from './meeting-picker.js'

const noSubscription = () => () => {}
const zero = () => 0

export function useOperationResult(session: OperationResultSession | undefined, scope: OperationScope, kinds: readonly OperationKind[]) {
  useSyncExternalStore(session?.subscribe ?? noSubscription, session?.getRevision ?? zero, zero)
  const generation = session?.getGeneration() ?? 0
  const lifetime = useRef(0)
  const scopeKey = JSON.stringify([scope.opportunityId, scope.milestoneId ?? null])
  useEffect(() => {
    lifetime.current++
    return () => { lifetime.current++ }
  }, [session, scopeKey, generation])
  const captureCurrent = useCallback(() => {
    const current = lifetime.current
    return () => lifetime.current === current
  }, [])
  return { operation: session?.getLatest(scope, kinds), generation, captureCurrent }
}

interface MeetingOperationClient {
  cacheSession?: { readonly operationResults: OperationResultSession }
  proposeMeetingFromRaw(opportunityId: string, content: string, meetingType: MeetingType): Promise<unknown>
  proposeMeetingFromTranscript(opportunityId: string, transcriptId: string): Promise<unknown>
}
type MeetingSource = { kind: 'raw'; content: string; meetingType: MeetingType } | { kind: 'transcript'; transcriptId: string }
const meetingKinds = ['meeting-extract'] as const

export function useMeetingOperation(client: MeetingOperationClient, opportunityId: string, opportunityName: string, onNote: (message: string) => void) {
  const session = client.cacheSession?.operationResults
  const { operation, generation, captureCurrent } = useOperationResult(session, { opportunityId }, meetingKinds)
  const retained = operation?.kind === 'meeting-extract' ? operation : undefined
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState<{ requestId: number; proposal: MeetingChangeSetProposal }>()
  const automaticReview = useRef<number | null>(null)

  useEffect(() => {
    setOpen(false); setReview(undefined); automaticReview.current = null
  }, [opportunityId, session, generation])

  useEffect(() => {
    if (!open || !retained || automaticReview.current !== retained.requestId) return
    if (retained.status === 'succeeded') {
      automaticReview.current = null
      setReview({ requestId: retained.requestId, proposal: retained.result })
    } else if (retained.status === 'failed') {
      automaticReview.current = null
      onNote(meetingListFailure(retained.error))
    }
  }, [open, retained, onNote])

  const close = () => { automaticReview.current = null; setOpen(false) }
  const toggle = () => {
    automaticReview.current = null
    if (open) setOpen(false)
    else {
      if (retained) session?.touch(retained.requestId)
      setOpen(true)
    }
  }
  const extract = (source: MeetingSource) => {
    if (!session) { onNote('Operation session is unavailable. Reload the application.'); return }
    try {
      automaticReview.current = session.startMeeting({ opportunityId }, { opportunityName }, async () =>
        meetingChangeSetProposalSchema.parse(source.kind === 'raw'
          ? await client.proposeMeetingFromRaw(opportunityId, source.content, source.meetingType)
          : await client.proposeMeetingFromTranscript(opportunityId, source.transcriptId)))
    } catch (error) {
      onNote(meetingListFailure(error))
    }
  }
  const restore = () => {
    if (retained?.status !== 'succeeded') { onNote('The retained result is no longer available. Extract the meeting again.'); return }
    session?.touch(retained.requestId)
    setReview({ requestId: retained.requestId, proposal: retained.result })
  }
  const beginSubmit = () => {
    if (review) session?.consume(review.requestId)
    return { isCurrent: captureCurrent() }
  }
  return {
    open, toggle, close, extract, restore, beginSubmit,
    busy: retained?.status === 'pending',
    canRestore: retained?.status === 'succeeded',
    error: retained?.status === 'failed' ? meetingListFailure(retained.error) : '',
    proposal: review?.proposal,
    dismissReview: () => setReview(undefined)
  }
}
