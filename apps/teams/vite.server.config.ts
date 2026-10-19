import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: fileURLToPath(new URL('./src/server.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'server.js' } }
  }
})
