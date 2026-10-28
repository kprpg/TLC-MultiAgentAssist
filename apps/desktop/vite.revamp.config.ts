import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { readVoiceModel, voiceModelName } from '../../scripts/prepare-voice-model.mjs'
import { voiceWorkerAssets, voiceWorkerFile, voiceWorkerCsp } from '../../scripts/voice-worker-assets.mjs'
import { fontScalePlugin } from '../shared/postcss-font-scale.js'
import { uiFontScale } from './renderer-revamp/src/font-scale.js'

export default defineConfig({
    css: { postcss: { plugins: [fontScalePlugin(uiFontScale)] } },
    plugins: [react(), {
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