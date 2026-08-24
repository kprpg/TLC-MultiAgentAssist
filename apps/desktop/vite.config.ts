import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'renderer'),
  base: './',
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, 'dist/renderer')
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})