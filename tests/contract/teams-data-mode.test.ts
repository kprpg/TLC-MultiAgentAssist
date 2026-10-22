import { describe, expect, it } from 'vitest'
import { teamsApiBasePath, teamsDataModesSchema, teamsDataModeVersion } from '../../packages/common/contracts/teams-data-mode.js'

const modes = {
  contractVersion: teamsDataModeVersion, initialMode: 'sample', runtimeMode: 'live',
  runtimeAuthentication: 'local-azure-cli', availableModes: ['sample', 'live']
}
describe('versioned Teams per-page data modes', () => {
  it('separates initial page mode from the immutable runtime identity', () => {
    expect(teamsDataModesSchema.parse(modes)).toEqual(modes)
    expect(teamsApiBasePath('sample', 'live')).toBe('/api/teams/sample')
    expect(teamsApiBasePath('live', 'sample')).toBe('/api/teams/live')
    expect(teamsApiBasePath('live', 'live')).toBe('/api/teams')
  })
  it.each([
    { contractVersion: '0.0' }, { initialMode: 'unknown' }, { availableModes: [] },
    { availableModes: ['live'] }, { availableModes: ['sample', 'sample'] },
    { availableModes: ['sample'] }, { runtimeAuthentication: 'browser-claimed-user' },
    { userId: 'not-authority' }, { token: 'must-not-be-public' }
  ])('rejects invalid capability metadata %#', (override) => {
    expect(teamsDataModesSchema.safeParse({ ...modes, ...override }).success).toBe(false)
  })
})
