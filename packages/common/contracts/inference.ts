import { z } from 'zod'

export const inferenceContractVersion = '1.0' as const
export const inferenceResponseVersion = '1.3' as const
export const inferenceModeSchema = z.enum(['sample', 'foundry'])
export type InferenceMode = z.infer<typeof inferenceModeSchema>
export const inferenceExecutionSchema = z.object({
  contractVersion: z.literal(inferenceContractVersion),
  correlationId: z.string().uuid(),
  requested: inferenceModeSchema,
  provider: inferenceModeSchema,
  state: z.enum(['complete', 'fallback']),
  reason: z.enum(['configuration', 'authentication', 'quota', 'timeout', 'validation', 'provider']).optional()
}).strict().refine((value) => value.state !== 'fallback' || value.provider === 'sample' && value.reason !== undefined,
'Fallback must identify the offline provider and its reason.')
export type InferenceExecution = z.infer<typeof inferenceExecutionSchema>
export interface InferenceResult<T> { value: T; execution: InferenceExecution }

export function validateInferenceResponse(value: { contractVersion?: string | undefined; inference?: unknown }, context: z.RefinementCtx): void {
  if ((value.contractVersion === inferenceResponseVersion) !== (value.inference !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Inference metadata requires the versioned inference response shape.' })
  }
}

export function inferenceLabel(execution: InferenceExecution): string {
  return execution.state === 'fallback'
    ? `Offline/sample fallback - Foundry unavailable (${execution.reason}).`
    : execution.provider === 'foundry' ? 'Sample data / Foundry AI' : 'Sample data / Offline AI'
}

export function resolveSampleInferenceMode(environment: Readonly<Record<string, string | undefined>>): InferenceMode {
  const value = environment['TLC_AI_MODE']?.trim().toLowerCase()
  return inferenceModeSchema.parse(value || 'foundry')
}
