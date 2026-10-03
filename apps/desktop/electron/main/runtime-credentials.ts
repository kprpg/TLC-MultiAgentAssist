import { AzureCliCredential, InteractiveBrowserCredential } from '@azure/identity'
import type { TokenCredential } from '@azure/core-auth'
import type { FoundryEnvironment } from '../../../../packages/common/configuration/foundry-environment.js'

export interface RuntimeCredentials {
  msx: TokenCredential
  foundry: TokenCredential
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
      })
    }
  }

  return {
    msx: new AzureCliCredential({ processTimeoutInMs: 30_000 }),
    foundry: new AzureCliCredential({
      tenantId: authentication.foundryTenantId,
      processTimeoutInMs: 30_000
    })
  }
}
