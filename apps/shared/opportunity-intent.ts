export function formatOpportunityIntent(values: readonly string[] | undefined): string {
  const labels = values?.map((value) => value.trim()).filter(Boolean) ?? []
  return labels.length > 0 ? labels.join(', ') : 'Not specified'
}
