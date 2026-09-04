import { AzureCliCredential, InteractiveBrowserCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/core-auth'
import type { FoundryEnvironment } from '../../../../packages/common/configuration/foundry-environment.js'

export interface RuntimeCredentials {
  msx: TokenCredential
  foundry: TokenCredential
  graph: TokenCredential
}

export function createRuntimeCredentials(
  authentication: FoundryEnvironment['authentication']
): RuntimeCredentials {
  if (authentication.mode === 'interactive-browser') {
    const appRegistration = authentication.appRegistration
    return {
      msx: new InteractiveBrowserCredential({
        tenantId: appRegistration.tenantId,
        clientId: appRegistration.clientId,
        redirectUri: appRegistration.redirectUri
      }),
      foundry: new InteractiveBrowserCredential({
        tenantId: authentication.foundryTenantId,
        clientId: appRegistration.clientId,
        redirectUri: appRegistration.redirectUri
      }),
      graph: new InteractiveBrowserCredential({
        tenantId: appRegistration.tenantId,
        clientId: appRegistration.clientId,
        redirectUri: appRegistration.redirectUri
      })
    }
  }

  const msx = new AzureCliCredential({ processTimeoutInMs: 30_000 })
  const foundry = new AzureCliCredential({
    tenantId: authentication.foundryTenantId,
    processTimeoutInMs: 30_000
  })
  const graph = authentication.appRegistration
    ? new InteractiveBrowserCredential({
        tenantId: authentication.appRegistration.tenantId,
        clientId: authentication.appRegistration.clientId,
        redirectUri: authentication.appRegistration.redirectUri
      })
    : new AzureCliCredential({ processTimeoutInMs: 30_000 })

  return {
    msx,
    foundry,
    graph
  }
}
