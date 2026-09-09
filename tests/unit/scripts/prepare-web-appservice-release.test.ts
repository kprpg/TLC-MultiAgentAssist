import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
    createAppServiceZip,
    createLinuxCanvasInstallArgs,
    createProductionInstallArgs,
    resolveNpmInvocation
} from '../../../scripts/prepare-web-appservice-release.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('App Service release package', () => {
    it('installs production dependencies for local smoke validation', () => {
        expect(createProductionInstallArgs('C:\\release')).toEqual([
            'install',
            '--omit=dev',
            '--ignore-scripts',
            '--package-lock=false',
            '--prefix',
            'C:\\release'
        ])
    })

    it('adds the matching Linux x64 canvas binding to the App Service package', () => {
        expect(createLinuxCanvasInstallArgs('C:\\release', {
            '@napi-rs/canvas-linux-x64-gnu': '0.1.80'
        })).toEqual([
            'install',
            '@napi-rs/canvas-linux-x64-gnu@0.1.80',
            '--omit=dev',
            '--ignore-scripts',
            '--package-lock=false',
            '--no-save',
            '--force',
            '--prefix',
            'C:\\release'
        ])
    })

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
        const files = Object.values(archive.files).filter((entry) => !entry.dir)
        expect(files.map((entry) => entry.name).sort()).toEqual([
            'apps/desktop/index.html',
            'package.json',
            'server.js'
        ])
        expect(archive.file('package/server.js')).toBeNull()
    })

    it('writes ZIP64 metadata for packages that may exceed the classic entry limit', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-web-appservice-many-files-test-'))
        temporaryDirectories.push(temporaryDirectory)
        const packageRoot = join(temporaryDirectory, 'package')
        const artifactPath = join(temporaryDirectory, 'release', 'app.zip')
        await mkdir(packageRoot, { recursive: true })
        await Promise.all(Array.from({ length: 512 }, (_, index) =>
            writeFile(join(packageRoot, `file-${index}.txt`), String(index))))

        await createAppServiceZip(packageRoot, artifactPath)

        const artifact = await readFile(artifactPath)
        expect(artifact.lastIndexOf(Buffer.from('PK\x06\x06', 'binary'))).toBeGreaterThan(-1)
        expect(artifact.lastIndexOf(Buffer.from('PK\x06\x07', 'binary'))).toBeGreaterThan(-1)
        const archive = await JSZip.loadAsync(artifact)
        const files = Object.values(archive.files).filter((entry) => !entry.dir)
        expect(files).toHaveLength(512)
    })
})