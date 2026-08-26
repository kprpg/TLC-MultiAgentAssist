import { describe, expect, it } from 'vitest'
import type { DesktopDataStatus } from '../../../packages/common/index.js'
import { getDataModeLabel } from '../../../apps/desktop/renderer/src/data-mode-label.js'

describe('desktop data mode label', () => {
  it('shows a neutral startup label before data mode resolves', () => {
    expect(getDataModeLabel(null)).toBe('STARTING')
  })

  it('does not mislabel live mode as sample when authentication fails', () => {
    const status: DesktopDataStatus = {
      mode: 'live',
      auth: { state: 'login-required', detail: 'Sign-in failed.' }
    }

    expect(getDataModeLabel(status)).toBe('LIVE MSX')
  })

  it('labels fixture mode as sample data', () => {
    const status: DesktopDataStatus = {
      mode: 'sample',
      auth: { state: 'ready', detail: 'Fixture mode is active.' }
    }

    expect(getDataModeLabel(status)).toBe('SAMPLE DATA')
  })
})