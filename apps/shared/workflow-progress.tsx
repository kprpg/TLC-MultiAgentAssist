import type { ReactNode } from 'react'

type WorkflowProgressProps = {
    run: { workflowId: string; status: string; state?: string | undefined }
    itemCount?: number | undefined
    sourceHealth?: ReadonlyArray<{ source: string; state: string; detail?: string }> | undefined
    children?: ReactNode
}

export function WorkflowProgress({ run, itemCount, sourceHealth, children }: WorkflowProgressProps) {
    const loading = run.status === 'queued' || run.status === 'running'
    const message = loading
        ? itemCount === undefined
            ? 'Workflow is running against the selected scope.'
            : `Loading results: ${itemCount} items so far. Results are incomplete while the play is running.`
        : run.status === 'cancelled'
            ? 'Workflow run cancelled. Any results shown are incomplete.'
            : run.status === 'failed'
                ? 'The play did not finish. Any results shown are incomplete.'
                : run.state === 'unauthorized'
                    ? 'Your delegated access does not include a required source or scope.'
                    : run.state === 'partial'
                        ? 'Workflow completed with partial source coverage. These results do not represent complete portfolio coverage.'
                        : run.status === 'completed' && run.state === 'complete'
                            ? 'Workflow completed with all required sources.'
                            : 'Workflow source coverage is unavailable. Do not treat these results as complete.'
    const gaps = sourceHealth?.filter((source) => source.state !== 'live' && source.state !== 'sample') ?? []
    return <div className={`workflow-run-state ${run.state ?? run.status}`} role="status">
        <div><strong>{run.workflowId}</strong><span>{run.state ?? run.status}</span></div>
        <p>{message}</p>
        {gaps.length > 0 && <ul>{gaps.map((source, index) => <li key={`${source.source}-${index}`}>{source.source}: {source.detail ?? source.state}</li>)}</ul>}
        {children}
    </div>
}
