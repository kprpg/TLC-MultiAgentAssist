import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { fontScalePlugin } from '../shared/postcss-font-scale.js'
import { uiFontScale } from '../shared/font-scale.js'

// Bundles the React webview to a single nonce-loadable IIFE plus one stylesheet.
export default defineConfig({
    css: { postcss: { plugins: [fontScalePlugin(uiFontScale)] } },
    plugins: [react()],
    // Library mode does not inline process.env; the webview has no `process`, so define it.
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env': '{}'
    },
    build: {
        outDir: resolve(__dirname, 'dist/webview'),
        emptyOutDir: true,
        sourcemap: false,
        lib: {
            entry: resolve(__dirname, 'src/webview/main.tsx'),
            formats: ['iife'],
            name: 'TlcAssistWebview',
            fileName: () => 'webview.js'
        },
        rollupOptions: {
            output: {
                assetFileNames: 'webview.[ext]'
            }
        }
    }
})
