import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSampleApplicationServices } from '../../../packages/orchestrator/application-runtime.js'
import { buildLiveDataProvider } from '../../../apps/vscode-extension/src/live-provider-core.js'
import { withPresentationCache } from '../../../apps/vscode-extension/src/presentation-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { seDomainIds } from '../../../packages/common/configuration/se-domains.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers() })
async function fixture() {
  const services = await createSampleApplicationServices()
  const core = services.orchestrator
  const portfolio = vi.spyOn(core, 'getPortfolioIndex')
  const discovery = vi.spyOn(core, 'getDiscoverySnapshot')
  const provider = withPresentationCache(buildLiveDataProvider({ orchestrator: core, host: services.workflows, account: 'synthetic',
    dispose: () => services.dispose() }, 'sample'))
  cleanup.push(() => provider.dispose())
  return { provider, portfolio, discovery }
}

describe('private native/provider presentation owner', () => {
  it('shares one capture between native tree reads and a recreated webview bridge', async () => {
    const { provider, portfolio, discovery } = await fixture()
    const accounts = await provider.listAccounts()
    if (!accounts[0]) throw new Error('Missing synthetic account')
    await provider.listOpportunities(accounts[0].id)
    await provider.getDiscoverySnapshot({ contractVersion: '1.0' })
    for (let pass = 0; pass < 3; pass++) {
      for (const domain of seDomainIds) await provider.discoverOpportunities(domain)
      const response = await routeBridgeMessage(provider, { kind: 'request', id: `panel-${pass}`, method: 'getPortfolioIndex', params: { contractVersion: '1.0' } })
      expect(response.ok).toBe(true)
    }
    expect(portfolio).toHaveBeenCalledOnce()
    expect(discovery).toHaveBeenCalledOnce()
  })
  it('cannot be reactivated by a hidden webview and resumes only when the native host permits it', async () => {
    vi.useFakeTimers()
    const { provider, portfolio } = await fixture()
    await provider.listAccounts()
    provider.setCacheInterest?.('webview:consumer', ['portfolio'], true)
    provider.setCacheSuspended?.('webview', true)
    provider.setCacheInterest?.('webview:consumer', ['portfolio'], true)
    await vi.advanceTimersByTimeAsync(300_010)
    expect(portfolio).toHaveBeenCalledOnce()
    provider.setCacheSuspended?.('webview', false)
    await vi.advanceTimersByTimeAsync(10)
    expect(portfolio).toHaveBeenCalledTimes(2)
    const revision = provider.cacheSession?.getRevision()
    provider.setCacheSuspended?.('webview', false)
    expect(provider.cacheSession?.getRevision()).toBe(revision)
  })
  it('keeps visible native trees independent of hidden webview consumers', async () => {
    vi.useFakeTimers()
    const { provider, portfolio } = await fixture()
    await provider.listAccounts()
    provider.setCacheInterest?.('native-tree', ['portfolio'], true)
    provider.setCacheInterest?.('webview:consumer', ['portfolio'], true)
    provider.setCacheSuspended?.('webview', true)
    await vi.advanceTimersByTimeAsync(300_010)
    expect(portfolio).toHaveBeenCalledTimes(2)
    provider.setCacheInterest?.('native-tree', [], false)
    await vi.advanceTimersByTimeAsync(300_010)
    expect(portfolio).toHaveBeenCalledTimes(2)
  })
})
