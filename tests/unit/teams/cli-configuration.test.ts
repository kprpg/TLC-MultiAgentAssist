import { describe, expect, it } from 'vitest'
import { isLocalConfiguration, isNativeConfiguration, loadTeamsConfiguration, loadTeamsRuntimeConfiguration } from '../../../apps/teams/src/configuration.js'
import { cliCapabilities, cliPublicConfigurationVersion, getCliCapabilities } from '../../../packages/common/contracts/local-connection.js'
import { teamsPublicConfigurationSchema } from '../../../packages/common/contracts/collaboration.js'

const environment = {
  TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-azure-cli', TLC_TEAMS_RUNTIME_PROFILE: 'local',
  TLC_TEAMS_ORIGIN: 'https://localhost:3978', TLC_TEAMS_TENANT_ID: '77777777-7777-4777-8777-777777777777',
  TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'cli-test'
}

describe('explicit current-user CLI live configuration', () => {
  it('uses existing CLI sign-in without native/API/SPA/bot registrations or secrets', () => {
    const configuration = loadTeamsConfiguration(environment)
    expect(isLocalConfiguration(configuration)).toBe(true)
    expect(isNativeConfiguration(configuration)).toBe(false)
    expect(configuration).toMatchObject({ mode: 'live', authentication: 'local-azure-cli', guidanceMode: 'deterministic', writeMode: 'read-only' })
    expect(loadTeamsRuntimeConfiguration(environment, configuration).profile).toBe('local')
    expect(JSON.stringify(configuration)).not.toMatch(/clientId|Credential|Secret/)
  })
  it('cannot authorize a public/shared listener, implicit sample switch or optional source scopes', () => {
    for (const changes of [
      { TLC_TEAMS_MODE: 'sample' }, { WEBSITE_SITE_NAME: 'shared-host' },
      { TLC_TEAMS_RUNTIME_PROFILE: 'azure' }, { TLC_TEAMS_HOST: '0.0.0.0' },
      { TLC_TEAMS_ORIGIN: 'https://public.example.com' }, { TLC_TEAMS_ORIGIN: 'http://localhost:3978' },
      { TLC_TEAMS_TENANT_ID: '' }, { TLC_TEAMS_MCP_SCOPE: 'https://elsewhere.crm.dynamics.com/mcp.tools' },
      { TLC_TEAMS_GRAPH_SCOPES: 'https://graph.microsoft.com/OnlineMeetings.Read' },
      { TLC_TEAMS_GUIDANCE_MODE: 'foundry' }
    ]) expect(() => loadTeamsConfiguration({ ...environment, ...changes })).toThrow()
  })
  it('enables reviewed writes only with a validated explicit mode', () => {
    expect(loadTeamsConfiguration({ ...environment, TLC_TEAMS_CLI_WRITE_MODE: 'reviewed' })).toMatchObject({ writeMode: 'reviewed' })
    for (const value of ['true', '', 'all']) expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_CLI_WRITE_MODE: value })).toThrow()
    expect(getCliCapabilities('reviewed').find((entry) => entry.id === 'reviewed-writes')?.state).toBe('requires-source-grant')
    expect(getCliCapabilities('reviewed').find((entry) => entry.id === 'mcp')?.state).toBe('unavailable-local')
  })
  it('versions the write-mode public shape without changing native protocol v1.0', () => {
    const configuration = {
      contractVersion: cliPublicConfigurationVersion, mode: 'live',
      authentication: 'local-azure-cli', writeMode: 'read-only', capabilities: cliCapabilities
    }
    expect(cliPublicConfigurationVersion).toBe('1.2')
    expect(teamsPublicConfigurationSchema.parse(configuration)).toEqual(configuration)
    expect(teamsPublicConfigurationSchema.safeParse({ ...configuration, contractVersion: '1.0' }).success).toBe(false)
    expect(teamsPublicConfigurationSchema.safeParse({ ...configuration, accessToken: 'not-public' }).success).toBe(false)
    expect(cliCapabilities.find((entry) => entry.id === 'reviewed-writes')?.state).toBe('unavailable-local')
    expect(cliCapabilities.find((entry) => entry.id === 'mcp')?.state).toBe('unavailable-local')
  })
})
