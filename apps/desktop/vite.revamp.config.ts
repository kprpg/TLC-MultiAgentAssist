import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { readVoiceModel, voiceModelName } from '../../scripts/prepare-voice-model.mjs'
import { voiceWorkerAssets, voiceWorkerFile, voiceWorkerCsp } from '../../scripts/voice-worker-assets.mjs'
import { fontScalePlugin } from '../shared/postcss-font-scale.js'
import { uiFontScale } from './renderer-revamp/src/font-scale.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ZodError } from 'zod'
import { createMomentumFocusHost } from '../../packages/orchestrator/momentum-focus/host.js'

const previewMomentum = createMomentumFocusHost({ mode: 'sample' })
async function momentumPreview(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (request.method !== 'POST') { next(); return }
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', 'no-store')
    if (request.headers['sec-fetch-site'] === 'cross-site' || request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        response.statusCode = 403; response.end(JSON.stringify({ error: 'Same-origin preview requests only.' })); return
    }
    const chunks: Buffer[] = []
    let bytes = 0
    try {
        for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bytes += buffer.length
            if (bytes > 1_048_576) { response.statusCode = 413; response.end(JSON.stringify({ error: 'The preview request exceeds its size limit.' })); return }
            chunks.push(buffer)
        }
        response.end(JSON.stringify(await previewMomentum.invoke(JSON.parse(Buffer.concat(chunks).toString('utf8')))))
    } catch (error) {
        response.statusCode = error instanceof ZodError || error instanceof SyntaxError ? 400 : 500
        response.end(JSON.stringify({ error: 'The synthetic Momentum preview request failed validation or execution.' }))
    }
}

export default defineConfig({
    css: { postcss: { plugins: [fontScalePlugin(uiFontScale)] } },
    plugins: [react(), {
        name: 'synthetic-momentum-host',
        configureServer(server) { server.middlewares.use('/api/momentum-focus', (request, response, next) => void momentumPreview(request, response, next)) },
        configurePreviewServer(server) { server.middlewares.use('/api/momentum-focus', (request, response, next) => void momentumPreview(request, response, next)) }
    }, {
        name: 'offline-voice-model',
        async load(id) {
            if (id.replaceAll('\\', '/').endsWith('/vosk-browser/dist/vosk.js')) {
                return (await voiceWorkerAssets()).library
            }
        },
        async generateBundle() {
            this.emitFile({ type: 'asset', fileName: `voice/${voiceModelName}`, source: await readVoiceModel() })
            this.emitFile({ type: 'asset', fileName: voiceWorkerFile, source: (await voiceWorkerAssets()).worker })
        },
        configureServer(server) {
            server.middlewares.use(`/${voiceWorkerFile}`, (_request, response, next) => {
                void voiceWorkerAssets().then((assets) => {
                    response.setHeader('content-type', 'text/javascript')
                    response.setHeader('content-security-policy', voiceWorkerCsp)
                    response.end(assets.worker)
                }).catch(next)
            })
            server.middlewares.use(`/voice/${voiceModelName}`, (_request, response, next) => {
                void readVoiceModel().then((data) => {
                    response.setHeader('content-type', 'application/gzip')
                    response.end(data)
                }).catch(next)
            })
        }
    }],
    optimizeDeps: { exclude: ['vosk-browser'] },
    root: resolve(__dirname, 'renderer-revamp'),
    base: './',
    build: {
        emptyOutDir: true,
        outDir: resolve(__dirname, 'dist/revamp'),
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'renderer-revamp/index.html'),
                desktop: resolve(__dirname, 'renderer-revamp/desktop.html')
            }
        }
    },
    server: {
        host: '127.0.0.1',
        port: 5174,
        strictPort: false
    }
})