import { useEffect, useState } from 'react'
import { inferenceLabel, type InferenceExecution, type InferenceMode } from '../../packages/common/contracts/inference.js'

export function InferenceNotice({ execution }: { execution?: InferenceExecution | undefined }) {
  if (!execution) return null
  return <p className="inference-notice" role={execution.state === 'fallback' ? 'alert' : 'status'}>{inferenceLabel(execution)}</p>
}

export function InferenceModeBadge({ label, mode, load }: {
  label: string
  mode?: InferenceMode | undefined
  load?: (() => Promise<InferenceMode | undefined>) | undefined
}) {
  const [resolved, setResolved] = useState(mode)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!load) return
    let current = true
    load().then((value) => { if (current) setResolved(value) }, () => {
      console.error('[inference-status] status-unavailable')
      if (current) setError(true)
    })
    return () => { current = false }
  }, [load])
  return <span className="mode-badge" title={resolved === 'foundry'
    ? 'Sample business data. Prompts and transcripts are sent to Foundry; do not enter real customer data or secrets.' : undefined}>
    {error ? 'AI status unavailable' : resolved ? `Sample data / ${resolved === 'foundry' ? 'Foundry AI' : 'Offline AI'}` : label}
  </span>
}
