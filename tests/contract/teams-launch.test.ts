import { describe, expect, it } from 'vitest'
import { teamsClientBuildSchema, teamsClientReadyRequestSchema, teamsLaunchStatusSchema, teamsLaunchVersion } from '../../packages/common/contracts/teams-launch.js'

describe('Teams launch verification contracts', () => {
  const identity = {
    contractVersion: teamsLaunchVersion, runId: '1'.repeat(32), clientBuildId: '22222222-2222-4222-8222-222222222222',
    packageId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b', packageVersion: '1.2484.12345',
    origin: 'https://localhost:3978', mode: 'live', authentication: 'local-azure-cli', clients: []
  }
  it('versions operational identity separately without allowing credentials or source identities', () => {
    expect(teamsLaunchStatusSchema.parse(identity)).toEqual(identity)
    for (const extra of [{ token: 'not-allowed' }, { account: 'private-user' }, { contractVersion: '2.0' }, { origin: 'https://localhost:3978/path' }]) {
      expect(teamsLaunchStatusSchema.safeParse({ ...identity, ...extra }).success).toBe(false)
    }
  })
  it('requires an exact build/run and a bounded client host, not an arbitrary success assertion', () => {
    const ready = { contractVersion: teamsLaunchVersion, runId: identity.runId, clientBuildId: identity.clientBuildId, packageVersion: identity.packageVersion, host: 'teams' }
    expect(teamsClientReadyRequestSchema.parse(ready)).toEqual(ready)
    for (const extra of [{ runId: 'wrong' }, { clientBuildId: 'latest' }, { packageVersion: 'latest' }, { host: 'desktop' }, { paired: true }, { pairingCode: 'A1B2C3D4' }]) {
      expect(teamsClientReadyRequestSchema.safeParse({ ...ready, ...extra }).success).toBe(false)
    }
    expect(teamsClientBuildSchema.parse({ contractVersion: teamsLaunchVersion, buildId: identity.clientBuildId }).buildId).toBe(identity.clientBuildId)
  })
})
