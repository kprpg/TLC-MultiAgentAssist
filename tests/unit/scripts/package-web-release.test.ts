import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packageWebRelease } from '../../../scripts/package-web-release.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('web release package', () => {
    it('stages the production host, renderer, runtime assets, and production manifest', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-web-release-'))
        temporaryDirectories.push(temporaryDirectory)
        const sourceRoot = join(temporaryDirectory, 'source')
        const outputRoot = join(temporaryDirectory, 'output')
        await writeFixture(sourceRoot)

        await packageWebRelease(outputRoot, sourceRoot)

        const packageJson = JSON.parse(await readFile(join(outputRoot, 'package.json'), 'utf8'))
        expect(packageJson).toMatchObject({
            name: '@tlc/web-release',
            private: true,
            scripts: { start: 'node server.js' }
        })
        expect(packageJson.dependencies).toHaveProperty('@azure/identity')
        expect(packageJson.dependencies).toHaveProperty('docx')
        expect(packageJson.dependencies).toHaveProperty('remark-gfm')
        expect(packageJson.dependencies).toHaveProperty('unified')
        await expect(stat(join(outputRoot, 'server.js'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(outputRoot, 'apps/desktop/dist/revamp/index.html'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(outputRoot, 'docs/knowledge/MCEM Overview.pdf'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(outputRoot, 'config/foundry.environment.example.json'))).resolves.toMatchObject({ isFile: expect.any(Function) })
        await expect(stat(join(outputRoot, 'config/foundry.environment.json'))).rejects.toThrow()
    })
})

async function writeFixture(sourceRoot: string) {
    const files: Record<string, string> = {
        'package.json': JSON.stringify({ engines: { node: '>=22.12.0' }, dependencies: { '@azure/identity': '1.0.0' } }),
        'apps/web/package.json': JSON.stringify({ version: '1.2.3', dependencies: { zod: '1.0.0' } }),
        'apps/desktop/package.json': JSON.stringify({ dependencies: { docx: '1.0.0', 'remark-gfm': '1.0.0', unified: '1.0.0' } }),
        'apps/web/dist/server.js': 'export {}',
        'apps/desktop/dist/revamp/index.html': '<div id="root"></div>',
        'docs/knowledge/MCEM Overview.pdf': 'fixture',
        'config/foundry.environment.example.json': '{}'
    }
    await Promise.all(Object.entries(files).map(async ([relativePath, contents]) => {
        const path = join(sourceRoot, relativePath)
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, contents)
    }))
}