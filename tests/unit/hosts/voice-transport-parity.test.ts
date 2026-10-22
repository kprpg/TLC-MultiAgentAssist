import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWebApiHandler, type WebRuntime } from '../../../apps/web/src/app.js'
import { createVoiceIpcHandler } from '../../../apps/desktop/electron/main/voice-ipc.js'
import { routeVoiceBridgeMessage } from '../../../apps/vscode-extension/src/voice-bridge.js'
import { SharedVoiceInputHost } from '../../../packages/orchestrator/voice-input.js'
import { voiceContractVersion, type VoiceSourceEvent } from '../../../packages/common/contracts/voice.js'

const sessionId = '11111111-1111-4111-8111-111111111111'
const version = { contractVersion: voiceContractVersion }
const headers = {
    'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
    'x-ms-token-aad-access-token': 'test-token', 'x-ms-client-principal': 'test-principal',
    'x-ms-client-principal-name': 'sample@example.test'
}

function harness() {
    let emit: (event: VoiceSourceEvent) => void = () => undefined
    const dispose = vi.fn()
    const host = new SharedVoiceInputHost({
        getAvailability: () => ({ available: true, engine: 'windows-offline', processing: 'on-device' }),
        start: (_request, onEvent) => {
            emit = onEvent
            emit({ ...version, type: 'started' })
            return { dispose, stop: () => emit({ ...version, type: 'ended' }) }
        }
    })
    return { host, dispose, segment: () => emit({ ...version, type: 'segment', segment: { id: '0', sequence: 1, text: 'grid', isFinal: true } }) }
}

function runtime(): WebRuntime {
    return {
        getPortfolioIndex: vi.fn(), getPortfolioWorkspace: vi.fn(), getDiscoverySnapshot: vi.fn(),
        listAccounts: vi.fn(), searchAccounts: vi.fn(), addAccount: vi.fn(), setAccountVisibility: vi.fn(),
        listOpportunities: vi.fn(), getRecordCreationCatalog: vi.fn(), previewRecordCreation: vi.fn(),
        commitRecordCreation: vi.fn(), exportRecordCreationDraft: vi.fn(),
        discoverOpportunities: vi.fn(), joinDealTeam: vi.fn(), leaveDealTeam: vi.fn(),
        joinMilestoneTeam: vi.fn(), leaveMilestoneTeam: vi.fn(), listMilestones: vi.fn(), listDiscoverableMilestones: vi.fn(),
        listMilestoneActivities: vi.fn(), createMilestoneActivity: vi.fn(), updateMilestone: vi.fn(),
        updateOpportunity: vi.fn(), transitionOpportunityStage: vi.fn(), runMcemCoach: vi.fn(), runAgentTask: vi.fn(),
        listMeetingTranscripts: vi.fn(), getMeetingTranscript: vi.fn(), proposeMeetingChangeSet: vi.fn(), applyMeetingChangeSet: vi.fn()
    }
}

describe('voice trusted-transport parity', () => {
    let server: Server | undefined
    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        server = undefined
    })

    async function listen(handler: ReturnType<typeof buildWebApiHandler>) {
        server = createServer((request, response) => void handler(request, response))
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('No TCP test listener')
        return `http://127.0.0.1:${address.port}/api/voice`
    }

    it('returns identical versioned start/read/stop/cancel results over IPC, HTTP and webview', async () => {
        const desktop = harness(), web = harness(), extension = harness()
        const ipc = createVoiceIpcHandler(desktop.host)
        const createRuntime = vi.fn(runtime)
        const url = await listen(buildWebApiHandler({ createRuntime, resolveVoiceHost: () => web.host }))
        async function compare(request: unknown) {
            const expected = await ipc(request)
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual(expected)
            expect(await routeVoiceBridgeMessage(extension.host, { kind: 'request', id: 'voice-1', method: 'voiceInput', params: request }))
                .toEqual({ kind: 'response', id: 'voice-1', ok: true, result: expected })
        }
        try {
            await compare({ ...version, operation: 'availability' })
            await compare({ ...version, operation: 'start', sessionId, locale: 'en-US', consent: true, hints: [] })
            for (const h of [desktop, web, extension]) h.segment()
            await compare({ ...version, operation: 'read', sessionId })
            await compare({ ...version, operation: 'stop', sessionId })
            await compare({ ...version, operation: 'cancel', sessionId })
            for (const h of [desktop, web, extension]) expect(h.dispose).toHaveBeenCalledTimes(1)
            expect(createRuntime).not.toHaveBeenCalled()
        } finally { for (const h of [desktop, web, extension]) h.host.dispose() }
    })

    it('retains HTTP authentication and forbids server microphone capture', async () => {
        const url = await listen(buildWebApiHandler({ createRuntime: runtime }))
        const body = JSON.stringify({ ...version, operation: 'availability' })
        expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(401)
        const response = await fetch(url, { method: 'POST', headers, body })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ kind: 'availability', availability: { available: false } })
        const crossOrigin = await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' }, body })
        expect(crossOrigin.status).toBe(403)
    })

    it('rejects invalid versions, extra paths and missing consent on every transport', async () => {
        const h = harness()
        const ipc = createVoiceIpcHandler(h.host)
        const url = await listen(buildWebApiHandler({ createRuntime: runtime, resolveVoiceHost: () => h.host }))
        try {
            const request = { ...version, operation: 'start', sessionId, locale: 'en-US', consent: false, inputFile: 'private.wav' }
            await expect(ipc(request)).rejects.toThrow()
            expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(request) })).status).toBe(400)
            expect(await routeVoiceBridgeMessage(h.host, { kind: 'request', id: 'voice-1', method: 'voiceInput', params: request }))
                .toMatchObject({ ok: false, error: { code: 'voice_failed' } })
        } finally { h.host.dispose() }
    })
})
