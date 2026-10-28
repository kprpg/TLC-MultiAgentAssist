import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/core-auth'
import { TableClient } from '@azure/data-tables'
import { EncryptedDocumentStore } from '../../../packages/connectors/common/encrypted-document-store.js'
import { SqliteDocumentStore, type ScopedDocumentStore } from '../../../packages/connectors/common/scoped-document-store.js'
import { TableDocumentStore } from '../../../packages/connectors/common/table-document-store.js'
import { loadTeamsStateKey, type TeamsConfiguration, type TeamsRuntimeConfiguration } from './configuration.js'
import { SampleInference } from '../../../packages/orchestrator/sample-inference.js'
import { loadFoundryEnvironmentFromEnvironment, type FoundryEnvironment } from '../../../packages/common/configuration/foundry-environment.js'

export function requiresTeamsFoundryCredential(environment: NodeJS.ProcessEnv, hosted: boolean, nativeFoundryGuidance: boolean): boolean {
  return hosted || nativeFoundryGuidance || environment['TLC_SE_REPORTING_ENABLED'] === '1'
}

export function createTeamsWorkloadCredential(runtime: TeamsRuntimeConfiguration, foundryTenantId: string, environment: NodeJS.ProcessEnv): TokenCredential {
  return runtime.profile === 'local'
    ? new AzureCliCredential({ tenantId: foundryTenantId, processTimeoutInMs: 30_000 })
    : new ManagedIdentityCredential(environment['AZURE_CLIENT_ID'] ? { clientId: environment['AZURE_CLIENT_ID'] } : {})
}

export function createTeamsSampleInference(runtime: TeamsRuntimeConfiguration, environment: NodeJS.ProcessEnv): SampleInference {
  let configuration: Promise<FoundryEnvironment> | undefined
  let credential: TokenCredential | undefined
  const loadEnvironment = () => {
    configuration ??= loadFoundryEnvironmentFromEnvironment(environment).catch((error: unknown) => {
      configuration = undefined
      throw error
    })
    return configuration
  }
  return new SampleInference({
    environment, hosted: runtime.profile === 'azure', loadEnvironment,
    credential: {
      async getToken(scopes, options) {
        credential ??= createTeamsWorkloadCredential(runtime, (await loadEnvironment()).authentication.foundryTenantId, environment)
        return credential.getToken(scopes, options)
      }
    }
  })
}

export async function createTeamsStateStore(configuration: TeamsConfiguration, runtime: TeamsRuntimeConfiguration, environment: NodeJS.ProcessEnv): Promise<{
  store: ScopedDocumentStore
  close(): void
}> {
  if (runtime.state.kind === 'table') {
    const credential = new ManagedIdentityCredential(environment['AZURE_CLIENT_ID'] ? { clientId: environment['AZURE_CLIENT_ID'] } : {})
    return { store: new TableDocumentStore(new TableClient(runtime.state.url, 'TlcTeams', credential)), close() {} }
  }
  const key = configuration.mode === 'live' ? loadTeamsStateKey(environment) : undefined
  if (runtime.state.path !== ':memory:') await mkdir(dirname(runtime.state.path), { recursive: true })
  // Base64 encryption envelopes must fit without reducing the 48 KB logical limit.
  const sqlite = new SqliteDocumentStore(runtime.state.path, { maxDocumentBytes: key ? 72_000 : 48_000 })
  const store = key ? new EncryptedDocumentStore(sqlite, key) : sqlite
  try {
    if (configuration.mode === 'live') {
      const partition = `runtime-key:${configuration.tenantId}:${configuration.environmentId}`
      const check = await store.read(partition, 'validation')
      if (check) {
        if (check.value !== 'tlc-local-state-v1') throw new Error('The local state encryption key check is invalid.')
      } else if (!await store.insert(partition, 'validation', 'tlc-local-state-v1')) {
        const current = await store.read(partition, 'validation')
        if (current?.value !== 'tlc-local-state-v1') throw new Error('The local state encryption key check could not be persisted.')
      }
    }
    return { store, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
