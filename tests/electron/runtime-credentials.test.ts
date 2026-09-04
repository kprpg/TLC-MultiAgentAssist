import { beforeEach, describe, expect, it, vi } from 'vitest'

const { AzureCliCredential, InteractiveBrowserCredential } = vi.hoisted(() => ({
  AzureCliCredential: vi.fn(function (options: unknown) { return { kind: 'azure-cli', options } }),
  InteractiveBrowserCredential: vi.fn(function (options: unknown) { return { kind: 'interactive', options } })
}))

vi.mock('@azure/identity', () => ({ AzureCliCredential, InteractiveBrowserCredential }))

import { createRuntimeCredentials } from '../../apps/desktop/electron/main/runtime-credentials.js'

const scopes = {
  foundry: ['https://ai.azure.com/.default'],
  msx: ['https://microsoftsales.crm.dynamics.com/.default'],
  graph: ['https://graph.microsoft.com/Mail.ReadWrite']
}

describe('runtime credentials', () => {
  beforeEach(() => {
    AzureCliCredential.mockClear()
    InteractiveBrowserCredential.mockClear()
  })

  it('targets only Foundry at the project tenant in Azure CLI mode', () => {
    createRuntimeCredentials({
      mode: 'azure-cli',
      expectedUserDomain: '@microsoft.com',
      foundryTenantId: '33333333-3333-4333-8333-333333333333',
      scopes
    })

    expect(AzureCliCredential).toHaveBeenNthCalledWith(1, { processTimeoutInMs: 30_000 })
    expect(AzureCliCredential).toHaveBeenNthCalledWith(2, {
      tenantId: '33333333-3333-4333-8333-333333333333',
      processTimeoutInMs: 30_000
    })
    expect(AzureCliCredential).toHaveBeenNthCalledWith(3, { processTimeoutInMs: 30_000 })
  })

  it('uses the public-client registration for Graph in Azure CLI mode when configured', () => {
    createRuntimeCredentials({
      mode: 'azure-cli',
      expectedUserDomain: '@microsoft.com',
      foundryTenantId: '33333333-3333-4333-8333-333333333333',
      scopes,
      appRegistration: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        clientId: '22222222-2222-4222-8222-222222222222',
        redirectUri: 'http://localhost'
      }
    })

    expect(AzureCliCredential).toHaveBeenCalledTimes(2)
    expect(InteractiveBrowserCredential).toHaveBeenCalledWith({
      tenantId: '11111111-1111-4111-8111-111111111111',
      clientId: '22222222-2222-4222-8222-222222222222',
      redirectUri: 'http://localhost'
    })
  })

  it('uses separate home and Foundry tenants in interactive browser mode', () => {
    createRuntimeCredentials({
      mode: 'interactive-browser',
      expectedUserDomain: '@microsoft.com',
      foundryTenantId: '33333333-3333-4333-8333-333333333333',
      scopes,
      appRegistration: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        clientId: '22222222-2222-4222-8222-222222222222',
        redirectUri: 'http://localhost'
      }
    })

    expect(InteractiveBrowserCredential).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: '11111111-1111-4111-8111-111111111111'
    }))
    expect(InteractiveBrowserCredential).toHaveBeenNthCalledWith(2, expect.objectContaining({
      tenantId: '33333333-3333-4333-8333-333333333333'
    }))
    expect(InteractiveBrowserCredential).toHaveBeenNthCalledWith(3, expect.objectContaining({
      tenantId: '11111111-1111-4111-8111-111111111111'
    }))
  })
})
