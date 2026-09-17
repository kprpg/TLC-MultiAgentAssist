import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
    files: 'test/**/*.test.cjs',
    version: 'stable',
    mocha: {
        ui: 'tdd',
        timeout: 120000
    }
})

