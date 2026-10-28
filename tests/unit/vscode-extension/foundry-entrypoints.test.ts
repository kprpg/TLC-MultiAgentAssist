import { describe, expect, it, vi } from 'vitest'
import { createSampleDataProvider } from '../../../apps/vscode-extension/src/data-provider.js'
import { routeBridgeMessage } from '../../../apps/vscode-extension/src/host-router.js'
import { currentFoundrySignIn } from '../../../apps/vscode-extension/src/foundry-sign-in.js'

const request = {
  contractVersion: '1.0', opportunityId: 'opp-grid-modernization',
  opportunityName: 'Synthetic opportunity', milestoneName: 'Synthetic milestone'
}

describe('explicit non-Guidance AI entrypoints retain sign-in admission', () => {
  it.each(['workingSessionTopic', 'workingSessionPrepare', 'seReporting'] as const)('%s owns a sign-in budget without enabling background sign-in', async (method) => {
    const provider = createSampleDataProvider()
    let admitted = false
    const stop = async () => {
      admitted = currentFoundrySignIn() !== undefined
      throw new Error('Synthetic stop before any model or filesystem operation.')
    }
    try {
      if (method === 'seReporting') {
        if (!provider.seReporting) throw new Error('Missing sample reporting host.')
        vi.spyOn(provider.seReporting, 'invoke').mockImplementation(stop)
      } else {
        if (!provider.workingSession) throw new Error('Missing sample working-session host.')
        vi.spyOn(provider.workingSession, method === 'workingSessionTopic' ? 'deriveTopic' : 'prepare').mockImplementation(stop)
      }
      const params = method === 'seReporting' ? { contractVersion: '1.0', operation: 'get' }
        : method === 'workingSessionTopic' ? request : {
          ...request,
          topic: {
            topic: 'Synthetic topic', domain: 'cloud', azureServices: [], deckQueries: ['synthetic'], learnQueries: ['synthetic'],
            iacScenario: 'Synthetic scenario', confidence: 'high', basis: 'rules', evidence: []
          },
          deliverables: { decks: true, learn: false, iac: false }
        }
      expect(await routeBridgeMessage(provider, { kind: 'request', id: method, method, params })).toMatchObject({ ok: false })
      expect(admitted).toBe(true)
      expect(currentFoundrySignIn()).toBeUndefined()
    } finally { vi.restoreAllMocks(); await provider.dispose() }
  })
})
