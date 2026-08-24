import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    emptyOutDir: true,
    ssr: resolve(__dirname, 'electron/main/index.ts'),
    outDir: resolve(__dirname, 'dist-electron/main'),
    rollupOptions: {
      external: ['electron'],
      output: { entryFileNames: 'index.js' }
    },
    sourcemap: true,
    target: 'node22'
  }
})