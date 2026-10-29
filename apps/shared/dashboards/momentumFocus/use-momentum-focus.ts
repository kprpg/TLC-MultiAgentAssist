import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    momentumFocusQuerySchema, type MomentumFocusQuery, type MomentumPriority, type MomentumSnapshot
} from '../../../../packages/common/contracts/momentum-focus.js'
import { MomentumDataSession, momentumCohortKey, type InvokeMomentumFocus } from './momentum-data-session.js'

export type { InvokeMomentumFocus } from './momentum-data-session.js'
export function useMomentumFocus(invoke: InvokeMomentumFocus) {
    const session = useMemo(() => new MomentumDataSession(invoke), [invoke])
    const [request, setRequest] = useState(() => ({
        query: momentumFocusQuerySchema.parse({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        operation: 'get' as 'get' | 'refresh', generation: 0
    }))
    const [result, setResult] = useState<{ session: MomentumDataSession; generation: number; snapshot: MomentumSnapshot } | null>(null)
    const [busy, setBusy] = useState(true)
    const [error, setError] = useState('')
    const [detail, setDetail] = useState<MomentumPriority | null>(null)
    const current = useRef(request)
    current.current = request
    const snapshot = result?.session === session && session.hasDataset(request.query) &&
        momentumCohortKey(result.snapshot.query) === momentumCohortKey(request.query) ? result.snapshot : null
    useEffect(() => () => session.invalidate(), [session])
    useEffect(() => {
        let active = true
        const loading = !session.hasDataset(request.query)
        setBusy(loading); setError(''); setDetail(null)
        if (loading) setResult(null)
        const load = async () => {
            try {
                const snapshot = await session.snapshot(request.query, request.operation === 'refresh')
                if (!active) return
                setDetail(null)
                setResult({ session, generation: request.generation, snapshot })
            } catch (failure) {
                if (active) { setResult(null); setError(failure instanceof Error ? failure.message : 'Momentum could not be loaded. Refresh and retry.') }
            } finally { if (active) setBusy(false) }
        }
        void load()
        return () => { active = false }
    }, [session, request])
    const updateQuery = useCallback((changes: Partial<MomentumFocusQuery>) => {
        try {
            const query = momentumFocusQuerySchema.parse({ ...current.current.query, ...changes, page: changes.page ?? 1 })
            const next = { query, operation: 'get' as const, generation: current.current.generation + 1 }
            current.current = next
            setRequest(next)
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'The selected filters are invalid.') }
    }, [])
    const refresh = useCallback(() => {
        session.invalidate()
        const next = { ...current.current, operation: 'refresh' as const, generation: current.current.generation + 1 }
        current.current = next
        setRequest(next)
    }, [session])
    const closeDetail = useCallback(() => setDetail(null), [])
    const select = useCallback((recordKey: string) => {
        if (!snapshot) return
        setError('')
        try {
            setDetail(session.detail(recordKey, snapshot))
        } catch (failure) {
            setDetail(null); setError(failure instanceof Error ? failure.message : 'The loaded item could not be opened.')
            if (!session.hasDataset(request.query)) setResult(null)
        }
    }, [session, request.query, snapshot])
    return { query: request.query, snapshot, busy, error, detail: snapshot && result?.generation === request.generation ? detail : null, updateQuery, refresh, select, closeDetail }
}
