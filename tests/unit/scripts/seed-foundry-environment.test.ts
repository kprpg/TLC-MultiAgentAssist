import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedFoundryEnvironment } from '../../../scripts/package-vscode-extension-release.mjs'

describe('CI Foundry configuration', () => {
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
