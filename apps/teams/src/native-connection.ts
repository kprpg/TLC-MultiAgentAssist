import { isAbsolute, join, relative, resolve } from 'node:path'
import { localConnectionVersion, type LocalOwnerResult } from '../../../packages/common/contracts/local-connection.js'
import { LiveMsxConnector } from '../../../packages/connectors/msx/live.js'
import { NativeConnectionError, NativeIdentityProvider, createNativeAuthenticationClient } from './native-identity.js'
import { LocalPairingAuthority, LocalPairingError } from './local-pairing.js'
import { readOwnerStateKey, startProtectedOwnerControl } from './local-owner-control.js'
import { isCliConfiguration, type LocalTeamsConfiguration } from './configuration.js'
import { CliIdentityProvider } from './cli-identity.js'

export async function createNativeConnection(configuration: LocalTeamsConfiguration, environment: NodeJS.ProcessEnv) {
  const configuredDirectory = environment['TLC_TEAMS_OWNER_DIRECTORY']
  if (!configuredDirectory) throw new Error('Native mode requires a prepared TLC_TEAMS_OWNER_DIRECTORY; use the local launcher.')
  const directory = resolve(configuredDirectory)
  const stateKey = await readOwnerStateKey(directory)
  if (environment['TLC_TEAMS_STATE_KEY'] && environment['TLC_TEAMS_STATE_KEY'] !== stateKey) throw new Error('Native state must use the protected local installation key.')
  const dataDirectory = resolve(environment['TLC_TEAMS_DATA_DIR'] ?? join(directory, 'data'))
  for (const path of [dataDirectory, environment['TLC_TEAMS_STATE_PATH']]) {
    if (!path) continue
    const child = relative(directory, resolve(path))
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Native private state must remain inside the protected local owner directory.')
  }
  const fetchImplementation: typeof fetch = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (isCliConfiguration(configuration) && configuration.writeMode === 'read-only' && !['GET', 'HEAD'].includes(method)) throw new NativeConnectionError('native_resource_unavailable')
    return fetch(input, {
      ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    })
  }
  const options = {
    probeMsxIdentity: async (token, identity) => {
      const msx = new LiveMsxConnector({ getAccessToken: async () => token }, fetchImplementation, `${configuration.msxResource}/api/data/v9.2/`)
      await msx.assertNativeIdentity(identity.userId)
    }
  } satisfies ConstructorParameters<typeof NativeIdentityProvider>[2]
  const provider = isCliConfiguration(configuration)
    ? new CliIdentityProvider(configuration, undefined, options)
    : new NativeIdentityProvider(configuration, createNativeAuthenticationClient(configuration), options)
  const pairing = new LocalPairingAuthority(configuration.origin, () => provider.identity(), { allowLocalSource: isCliConfiguration(configuration) })
  return {
    provider, pairing, fetchImplementation,
    environment: { ...environment, TLC_TEAMS_STATE_KEY: stateKey, TLC_TEAMS_DATA_DIR: dataDirectory },
    status: () => provider.status(),
    async refreshIdentity() {
      await provider.getToken('msx', true)
    },
    async startOwnerControl(stopOwnedWork: () => Promise<void>) {
      return startProtectedOwnerControl({
        directory, origin: configuration.origin,
        onError: (code) => console.error(`[teams-owner] ${code}`),
        execute: async (command): Promise<LocalOwnerResult> => {
          try {
            if (command.action === 'connect') {
              if (command.resource === 'msx') {
                await provider.disconnect()
                await stopOwnedWork()
              }
              await provider.connect(command.resource)
            } else if (command.action === 'approve') pairing.approve(command.userCode)
            else if (command.action === 'disconnect') {
              pairing.invalidate()
              await provider.disconnect()
              await stopOwnedWork()
            }
            return { contractVersion: localConnectionVersion, ok: true, status: provider.status(), pending: pairing.pending() }
          } catch (error) {
            const code = error instanceof NativeConnectionError || error instanceof LocalPairingError ? error.code : 'native_owner_command_failed'
            console.error(`[teams-owner] ${code}`)
            return { contractVersion: localConnectionVersion, ok: false, error: code }
          }
        }
      })
    }
  }
}
