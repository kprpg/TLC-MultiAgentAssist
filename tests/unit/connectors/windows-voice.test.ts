import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WindowsVoiceCaptureDriver } from '../../../packages/connectors/common/windows-voice.js'
import { voiceContractVersion, type VoiceSourceEvent } from '../../../packages/common/contracts/voice.js'
import statements from '../../fixtures/voice-input/statements.json' with { type: 'json' }

describe('offline Windows voice capture', () => {
    it('never probes or captures a potentially remote extension-host microphone', () => {
        const driver = new WindowsVoiceCaptureDriver({ remote: true })
        expect(driver.getAvailability()).toMatchObject({ available: false, reason: 'remote-host' })
        expect(() => driver.start({
            contractVersion: voiceContractVersion, operation: 'start', sessionId: '11111111-1111-4111-8111-111111111111',
            locale: 'en-US', consent: true, hints: []
        }, () => undefined)).toThrow('local Windows')
    })

    it.runIf(process.platform === 'win32' && process.env['TLC_RUN_VOICE_AUDIO_TESTS'] === '1').each(statements)(
        'transcribes real recorded audio for $id using the same production engine', async (statement) => {
            const driver = new WindowsVoiceCaptureDriver({
                inputFile: resolve('tests', 'fixtures', 'voice-input', 'recordings', `${statement.id}.wav`)
            })
            expect(await driver.getAvailability()).toMatchObject({ available: true, processing: 'on-device' })
            const events: VoiceSourceEvent[] = []
            let handle: ReturnType<typeof driver.start> | undefined
            try {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Recorded speech recognition timed out.')), 15_000)
                    handle = driver.start({
                        contractVersion: voiceContractVersion, operation: 'start',
                        sessionId: '11111111-1111-4111-8111-111111111111', locale: 'en-US', consent: true,
                        hints: statements.map((item) => item.text)
                    }, (event) => {
                        events.push(event)
                        if (event.type === 'ended') { clearTimeout(timeout); resolve() }
                        if (event.type === 'error') { clearTimeout(timeout); reject(new Error(event.message)) }
                    })
                })
                const actual = events.flatMap((event) => event.type === 'segment' && event.segment.isFinal ? [event.segment.text] : []).join(' ')
                expect(actual.toLowerCase().replace(/[.]/g, '')).toBe(statement.text)
                expect(events.some((event) => event.type === 'started')).toBe(true)
            } finally { handle?.dispose() }
        }, 20_000
    )
})
