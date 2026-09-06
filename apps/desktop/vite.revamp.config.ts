import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [react()],
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