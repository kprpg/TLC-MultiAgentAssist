import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    ssr: true,
    outDir: resolve('test-results', 'backend-performance-host'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      input: {
        main: resolve('tests', 'fixtures', 'performance', 'electron-main.ts'),
        preload: resolve('apps', 'desktop', 'electron', 'preload', 'index.ts')
      },
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: '[name].cjs' }
    }
  }
})
