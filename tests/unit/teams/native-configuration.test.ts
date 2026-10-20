import { describe, expect, it } from 'vitest'
import { isNativeConfiguration, loadTeamsConfiguration, loadTeamsRuntimeConfiguration } from '../../../apps/teams/src/configuration.js'

const environment = {
  TLC_TEAMS_MODE: 'live', TLC_TEAMS_AUTH_MODE: 'local-interactive', TLC_TEAMS_RUNTIME_PROFILE: 'local',
  TLC_TEAMS_ORIGIN: 'https://localhost:3978', TLC_TEAMS_TENANT_ID: '77777777-7777-4777-8777-777777777777',
  TLC_TEAMS_NATIVE_CLIENT_ID: '88888888-8888-4888-8888-888888888888',
  TLC_TEAMS_NATIVE_REDIRECT_URI: 'http://localhost',
  TLC_TEAMS_MSX_RESOURCE: 'https://example.crm.dynamics.com', TLC_TEAMS_ENVIRONMENT_ID: 'native-test'
}

describe('explicit local-native configuration', () => {
  it('needs no API/SPA/bot secret or Foundry resource to validate a private local installation', () => {
    const config = loadTeamsConfiguration(environment)
    expect(isNativeConfiguration(config)).toBe(true)
    expect(config).toMatchObject({ mode: 'live', authentication: 'local-interactive', nativeClientId: environment.TLC_TEAMS_NATIVE_CLIENT_ID })
    expect(JSON.stringify(config)).not.toContain('Credential')
    expect(loadTeamsRuntimeConfiguration(environment, config).profile).toBe('local')
    expect(() => loadTeamsConfiguration({ ...environment, TLC_TEAMS_AUTH_MODE: 'typo' })).toThrow()
  })
  it('cannot opt a hosted/public listener into local owner authority', () => {
    for (const changes of [
      { WEBSITE_SITE_NAME: 'hosted' }, { TLC_TEAMS_RUNTIME_PROFILE: 'azure' },
      { TLC_TEAMS_ORIGIN: 'https://public.contoso.net' }, { TLC_TEAMS_ORIGIN: 'http://localhost:3978' },
      { TLC_TEAMS_HOST: '0.0.0.0' }, { TLC_TEAMS_NATIVE_REDIRECT_URI: 'https://evil.example/callback' },
      { TLC_TEAMS_NATIVE_CLIENT_ID: '22222222-2222-4222-8222-222222222222' },
      { TLC_TEAMS_MCP_SCOPE: 'https://elsewhere.crm.dynamics.com/mcp.tools' }
    ]) expect(() => loadTeamsConfiguration({ ...environment, ...changes })).toThrow()
  })
  it('retains sample defaults and never makes local-native the implicit live strategy', () => {
    expect(loadTeamsConfiguration({}).mode).toBe('sample')
    expect(isNativeConfiguration(loadTeamsConfiguration({}))).toBe(false)
    expect(() => loadTeamsConfiguration({ TLC_TEAMS_MODE: 'live' })).toThrow()
  })
})
