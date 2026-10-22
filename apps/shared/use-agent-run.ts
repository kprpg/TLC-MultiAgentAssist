import { useCallback, useRef, useState } from 'react'
import type { AgentCapability, AgentTaskResponse } from '../../packages/common/contracts/index.js'
import { progressToResponse, type AgentStreamProgress } from './agent-stream.js'

export type AgentInvoke = (
    capability: AgentCapability,
    accountId: string,
    opportunityId: string,
    prompt: string,
    onProgress: (progress: AgentStreamProgress) => void,
    signal: AbortSignal
) => Promise<AgentTaskResponse>

/**
 * Progressive agent run shared by the React UIs: shows the instant evidence-based draft, then streamed
 * text, then the authoritative response, and supports cancellation. A newer run supersedes an older one.
 */
export function useAgentRun(invoke: AgentInvoke) {
    const [agentResult, setAgentResult] = useState<AgentTaskResponse | null>(null)
    const [agentLoading, setAgentLoading] = useState(false)
    const [agentPhase, setAgentPhase] = useState<AgentStreamProgress['phase'] | null>(null)
    const controller = useRef<AbortController | null>(null)
    const invokeRef = useRef(invoke)
    invokeRef.current = invoke

    const cancelAgent = useCallback(() => {
        controller.current?.abort()
        controller.current = null
        setAgentResult(null)
        setAgentLoading(false)
        setAgentPhase(null)
    }, [])

    const runAgent = useCallback(async (
        capability: AgentCapability, accountId: string, opportunityId: string, prompt: string, isCurrent: () => boolean = () => true
    ): Promise<void> => {
        controller.current?.abort()
        const own = new AbortController()
        controller.current = own
        setAgentResult(null)
        setAgentLoading(true)
        setAgentPhase(null)
        try {
            const response = await invokeRef.current(capability, accountId, opportunityId, prompt, (progress) => {
                if (own.signal.aborted || !isCurrent()) return
                setAgentPhase(progress.phase)
                setAgentResult(progressToResponse(progress, capability))
            }, own.signal)
            if (!own.signal.aborted && isCurrent()) setAgentResult(response)
        } catch (error) {
            if (own.signal.aborted) return
            throw error
        } finally {
            if (controller.current === own) {
                controller.current = null
                if (isCurrent()) { setAgentLoading(false); setAgentPhase(null) }
            }
        }
    }, [])

    return { agentResult, setAgentResult, agentLoading, setAgentLoading, agentPhase, runAgent, cancelAgent }
}
