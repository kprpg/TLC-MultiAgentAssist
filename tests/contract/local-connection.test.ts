import { describe, expect, it } from 'vitest'
import {
  localConnectionVersion, localPairRequestSchema, localPairExchangeSchema, localPairResultSchema,
  nativePublicConfigurationSchema, nativeCapabilities, cliCapabilities, cliPublicConfigurationVersion, getCliCapabilities
} from '../../packages/common/contracts/local-connection.js'
import { teamsPublicConfigurationSchema } from '../../packages/common/contracts/collaboration.js'

describe('local native connection contracts', () => {
  it('versions the CLI public profile without changing the owner/pairing protocol or claiming writer authority', () => {
    expect(localConnectionVersion).toBe('1.0')
    expect(cliPublicConfigurationVersion).toBe('1.2')
    const config = { contractVersion: cliPublicConfigurationVersion, mode: 'live', authentication: 'local-azure-cli', writeMode: 'read-only', capabilities: cliCapabilities }
    expect(teamsPublicConfigurationSchema.parse(config)).toEqual(config)
    expect(teamsPublicConfigurationSchema.safeParse({ ...config, contractVersion: localConnectionVersion }).success).toBe(false)
    expect(teamsPublicConfigurationSchema.safeParse({ ...config, isFte: true }).success).toBe(false)
    expect(cliCapabilities.find((entry) => entry.id === 'reviewed-writes')?.state).toBe('unavailable-local')
    const reviewed = { ...config, writeMode: 'reviewed', capabilities: getCliCapabilities('reviewed') }
    expect(teamsPublicConfigurationSchema.parse(reviewed)).toEqual(reviewed)
    expect(teamsPublicConfigurationSchema.safeParse({ ...reviewed, contractVersion: '1.1' }).success).toBe(false)
    expect(teamsPublicConfigurationSchema.safeParse({ ...reviewed, writeMode: 'unrestricted' }).success).toBe(false)
  })
  it('versions the new protocol independently while preserving existing public configuration', () => {
    expect(teamsPublicConfigurationSchema.parse({ mode: 'sample' })).toEqual({ mode: 'sample' })
    const config = { contractVersion: localConnectionVersion, mode: 'live', authentication: 'local-interactive', capabilities: nativeCapabilities }
    expect(nativePublicConfigurationSchema.parse(config)).toEqual(config)
    expect(teamsPublicConfigurationSchema.parse(config)).toEqual(config)
    expect(() => nativePublicConfigurationSchema.parse({ ...config, contractVersion: 'invalid' })).toThrow()
    expect(() => nativePublicConfigurationSchema.parse({ ...config, clientSecret: 'not-allowed' })).toThrow()
  })
  it('accepts only bounded challenge/verifier exchanges, never browser authority claims', () => {
    expect(localPairRequestSchema.parse({ contractVersion: localConnectionVersion, challenge: 'a'.repeat(43) }).challenge).toHaveLength(43)
    for (const value of [
      { challenge: 'short' }, { challenge: 'a'.repeat(43), isFte: true }, { challenge: 'a'.repeat(43), roles: ['TLC.Teams.Writer'] },
      { challenge: 'a'.repeat(43), localSourceAccess: 'reviewed' }, { challenge: 'a'.repeat(43), writeMode: 'reviewed' }
    ]) expect(localPairRequestSchema.safeParse({ contractVersion: localConnectionVersion, ...value }).success).toBe(false)
    expect(localPairExchangeSchema.safeParse({ contractVersion: localConnectionVersion, requestId: 'not-a-guid', verifier: 'a'.repeat(43) }).success).toBe(false)
  })
  it('requires a transient opaque local session and exposes the full capability matrix', () => {
    expect(localPairResultSchema.safeParse({
      contractVersion: localConnectionVersion, state: 'paired', token: 'source-token',
      expiresAt: '2026-10-19T00:00:00.000Z'
    }).success).toBe(false)
    for (const capability of ['msx', 'mcp', 'reviewed-writes', 'foundry', 'graph', 'shared-contexts', 'stage', 'bot', 'notifications', 'seller-dashboard']) {
      expect(nativeCapabilities.some((entry) => entry.id === capability)).toBe(true)
    }
  })
})
