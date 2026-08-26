import type { DesktopDataStatus } from '../../../../packages/common/index.js'

export function getDataModeLabel(dataStatus: DesktopDataStatus | null): 'STARTING' | 'LIVE MSX' | 'SAMPLE DATA' {
  if (!dataStatus) return 'STARTING'
  return dataStatus.mode === 'live' ? 'LIVE MSX' : 'SAMPLE DATA'
}