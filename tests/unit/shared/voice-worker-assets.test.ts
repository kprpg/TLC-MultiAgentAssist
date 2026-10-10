import { describe, expect, it } from 'vitest'
import { voiceWorkerAssets, voiceWorkerCsp, voiceWorkerFile } from '../../../scripts/voice-worker-assets.mjs'

describe('offline speech build assets', () => {
    it('extracts the pinned recognition worker while keeping dynamic evaluation out of the page', async () => {
        const assets = await voiceWorkerAssets()
        expect(assets.worker).toContain('new RecognizerWorker()')
        expect(assets.library).toContain(voiceWorkerFile)
        expect(assets.library).not.toContain('var WorkerFactory = createBase64WorkerFactory(')
        expect(assets.library.length).toBeLessThan(50_000)
        expect(voiceWorkerCsp).toContain("default-src 'none'")
        expect(voiceWorkerCsp).toContain("connect-src 'self'")
    })
})
