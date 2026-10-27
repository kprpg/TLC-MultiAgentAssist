import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedFoundryEnvironment } from '../../../scripts/package-vscode-extension-release.mjs'

describe('CI Foundry configuration', () => {
    it('seeds the web release configuration before validation', async () => {
        const workflow = await readFile(new URL('../../../.github/workflows/web-release.yml', import.meta.url), 'utf8')
        const steps = workflow.split(/^\s*- name: /m)
        const seedIndex = steps.findIndex((step) => step.includes('await seedFoundryEnvironment()'))
        const validationIndex = steps.findIndex((step) => step.includes('run: npm run phase0:check'))

        expect(seedIndex).toBeGreaterThan(0)
        expect(validationIndex).toBeGreaterThan(seedIndex)
        expect(steps[seedIndex]).toContain("import { seedFoundryEnvironment } from './scripts/package-vscode-extension-release.mjs'")
    })

    it.each([false, true])('seeds a clean checkout without overwriting existing configuration (existing: %s)', async (existing) => {
        const sourceRoot = await mkdtemp(join(tmpdir(), 'tlc-foundry-seed-'))
        const configDirectory = join(sourceRoot, 'config')
        const target = join(configDirectory, 'foundry.environment.json')
        const defaultContent = JSON.stringify({ environment: 'shared' })
        const customContent = JSON.stringify({ environment: 'developer' })
        try {
            await mkdir(configDirectory)
            await writeFile(join(configDirectory, 'foundry.environment.default.json'), defaultContent)
            if (existing) await writeFile(target, customContent)

            expect(await seedFoundryEnvironment(sourceRoot)).toBe(!existing)
            expect(await readFile(target, 'utf8')).toBe(existing ? customContent : defaultContent)
            expect(await seedFoundryEnvironment(sourceRoot)).toBe(false)
        } finally {
            await rm(sourceRoot, { recursive: true, force: true })
        }
    })
})
