import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createAppServiceZip, resolveNpmInvocation } from '../../../scripts/prepare-web-appservice-release.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('App Service release package', () => {
    it('runs npm through Node on Windows without a command shell', () => {
        expect(resolveNpmInvocation({
            platform: 'win32',
            nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
            npmExecPath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
        })).toEqual({
            command: 'C:\\Program Files\\nodejs\\node.exe',
            argsPrefix: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']
        })
    })

    it('places application files at the ZIP root', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-web-appservice-test-'))
        temporaryDirectories.push(temporaryDirectory)
        const packageRoot = join(temporaryDirectory, 'package')
        const artifactPath = join(temporaryDirectory, 'release', 'app.zip')
        await mkdir(join(packageRoot, 'apps', 'desktop'), { recursive: true })
        await writeFile(join(packageRoot, 'server.js'), 'export {}')
        await writeFile(join(packageRoot, 'package.json'), '{}')
        await writeFile(join(packageRoot, 'apps', 'desktop', 'index.html'), '<main></main>')

        await createAppServiceZip(packageRoot, artifactPath)

        const archive = await JSZip.loadAsync(await readFile(artifactPath))
        const files = Object.values(archive.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort()
        expect(files).toEqual([
            'apps/desktop/index.html',
            'package.json',
            'server.js'
        ])
        expect(archive.file('package/server.js')).toBeNull()
    })

    it('archives more files than the Windows open-file limit permits at once', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-web-appservice-many-files-test-'))
        temporaryDirectories.push(temporaryDirectory)
        const packageRoot = join(temporaryDirectory, 'package')
        const artifactPath = join(temporaryDirectory, 'release', 'app.zip')
        await mkdir(packageRoot, { recursive: true })
        await Promise.all(Array.from({ length: 512 }, (_, index) =>
            writeFile(join(packageRoot, `file-${index}.txt`), String(index))))

        await createAppServiceZip(packageRoot, artifactPath)

        const archive = await JSZip.loadAsync(await readFile(artifactPath))
        const files = Object.values(archive.files).filter((entry) => !entry.dir)
        expect(files).toHaveLength(512)
    })
})