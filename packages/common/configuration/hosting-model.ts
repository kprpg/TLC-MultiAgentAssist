export const hostingModelDeclaration = {
  model: 'single-instance',
  workflowState: 'process-local',
  preferenceFiles: 'single-process'
} as const

export type HostingModelDeclaration = typeof hostingModelDeclaration

/**
 * Workflow runs, their results and the JSON preference files live in one process's memory/disk, so
 * only one instance may serve a deployment. Any other declared model fails closed at startup rather
 * than letting replicas silently lose runs or overwrite each other's preferences.
 */
export function resolveHostingModel(environment: Readonly<Record<string, string | undefined>>): HostingModelDeclaration {
  const declared = environment['TLC_HOSTING_MODEL']?.trim().toLowerCase()
  if (declared && declared !== hostingModelDeclaration.model) {
    throw new Error(
      `Unsupported TLC_HOSTING_MODEL "${declared}"; only "${hostingModelDeclaration.model}" is supported. ` +
      'Workflow runs and preference files are process-local, so run one instance, or implement shared workflow state with run ownership and recovery before scaling out.'
    )
  }
  return hostingModelDeclaration
}
