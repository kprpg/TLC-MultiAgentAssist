import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    emptyOutDir: true,
    ssr: resolve(__dirname, 'electron/preload/index.ts'),
    outDir: resolve(__dirname, 'dist-electron/preload'),
    rollupOptions: {
      external: ['electron'],
      output: { entryFileNames: 'index.cjs', format: 'cjs' }
    },
    sourcemap: true,
    target: 'node22'
  }
})