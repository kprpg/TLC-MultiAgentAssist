import { createServer } from 'node:http'
import { SharedVoiceInputHost } from '../../../packages/orchestrator/voice-input.js'
import { WindowsVoiceCaptureDriver } from '../../../packages/connectors/common/windows-voice.js'
import type { VoiceSourceEvent } from '../../../packages/common/contracts/voice.js'

export async function recordedVoiceHost(inputFile: string) {
    const driver = new WindowsVoiceCaptureDriver({ inputFile })
    const events: VoiceSourceEvent[] = []
    const host = new SharedVoiceInputHost({
        getAvailability: () => driver.getAvailability(),
        start(request, onEvent) {
            return driver.start(request, (event) => {
                events.push(event)
                onEvent(event)
            })
        }
    })
    const server = createServer((request, response) => {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { body += chunk })
        request.on('end', () => {
            void host.invoke(JSON.parse(body)).then((result) => {
                response.setHeader('content-type', 'application/json')
                response.end(JSON.stringify(result))
            }).catch((error: unknown) => {
                response.statusCode = 400
                response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Test voice request failed.' }))
            })
        })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Voice fixture server did not bind.')
    return {
        url: `http://127.0.0.1:${address.port}`,
        host, events,
        async close() {
            host.dispose()
            await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        }
    }
}
