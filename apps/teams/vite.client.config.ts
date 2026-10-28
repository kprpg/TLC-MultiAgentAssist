import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { teamsLaunchVersion } from '../../packages/common/contracts/teams-launch.js'
import { fontScalePlugin } from '../shared/postcss-font-scale.js'
import { uiFontScale } from '../shared/font-scale.js'

const buildId = randomUUID()

export default defineConfig({
  css: { postcss: { plugins: [fontScalePlugin(uiFontScale)] } },
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  define: { __TLC_TEAMS_CLIENT_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), {
    name: 'teams-client-build-identity',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ contractVersion: teamsLaunchVersion, buildId }) })
    }
  }],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1600
  }
})
