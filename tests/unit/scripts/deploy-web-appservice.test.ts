import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'

const executeFile = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const scriptPath = join(repositoryRoot, 'scripts', 'deploy-web-appservice.ps1')
const temporaryDirectories: string[] = []
const powershellScriptTimeoutMs = 20_000

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('App Service deployment script', () => {
    it('accepts a complete package without contacting Azure', async () => {
        const artifactPath = await createArtifact(async (zip) => {
            zip.file('package.json', '{}')
            zip.file('server.js', 'export {}')
        })

        const result = await executeFile('pwsh', [
            '-NoProfile',
            '-File', scriptPath,
            '-SkipBuild',
            '-PackageOnly',
            '-ArtifactPath', artifactPath
        ])

        expect(result.stdout).toContain('Validated App Service package')
        expect(result.stdout).toContain('Azure was not contacted')
    }, powershellScriptTimeoutMs)

    it('rejects an archive without a central directory', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-deploy-script-test-'))
        temporaryDirectories.push(temporaryDirectory)
        const artifactPath = join(temporaryDirectory, 'truncated.zip')
        await writeFile(artifactPath, Buffer.from('PK\x03\x04incomplete', 'binary'))

        await expect(executeFile('pwsh', [
            '-NoProfile',
            '-File', scriptPath,
            '-SkipBuild',
            '-PackageOnly',
            '-ArtifactPath', artifactPath
        ])).rejects.toMatchObject({
            stderr: expect.stringContaining('App Service package validation failed')
        })
    }, powershellScriptTimeoutMs)

    it('rejects a package without required root files', async () => {
        const artifactPath = await createArtifact(async (zip) => {
            zip.file('package/package.json', '{}')
            zip.file('package/server.js', 'export {}')
        })

        await expect(executeFile('pwsh', [
            '-NoProfile',
            '-File', scriptPath,
            '-SkipBuild',
            '-PackageOnly',
            '-ArtifactPath', artifactPath
        ])).rejects.toMatchObject({
            stderr: expect.stringMatching(/missing[\s\S]*required root entry 'package\.json'/)
        })
    }, powershellScriptTimeoutMs)

    it('uses independent health validation instead of Azure CLI deployment tracking', async () => {
        const artifactPath = await createArtifact(async (zip) => {
            zip.file('package.json', '{}')
            zip.file('server.js', 'export {}')
        })
        const temporaryDirectory = temporaryDirectories.at(-1)!
        const azLogPath = join(temporaryDirectory, 'az-arguments.log')
        const foundryEnvironmentPath = join(repositoryRoot, 'config', 'foundry.environment.default.json')
        await installAzureCliMock(temporaryDirectory, azLogPath)

        await executeFile('pwsh', [
            '-NoProfile',
            '-File', scriptPath,
            '-SkipBuild',
            '-SkipHealthCheck',
            '-Confirm:$false',
            '-ArtifactPath', artifactPath,
            '-FoundryEnvironmentPath', foundryEnvironmentPath
        ], {
            env: {
                ...process.env,
                PATH: [temporaryDirectory, process.env.PATH ?? ''].filter(Boolean).join(delimiter)
            }
        })

        const azArguments = await readFile(azLogPath, 'utf8')
        expect(azArguments).toContain('webapp config appsettings set')
        expect(azArguments).toContain('--settings TLC_FOUNDRY_ENV_BASE64=')
        expect(azArguments).toContain('WEBSITE_RUN_FROM_PACKAGE=1')
        expect(azArguments).toContain('--track-status false')
    }, powershellScriptTimeoutMs)

    it('reconciles an Azure CLI failure when App Service accepted the deployment', async () => {
        const artifactPath = await createArtifact(async (zip) => {
            zip.file('package.json', '{}')
            zip.file('server.js', 'export {}')
        })
        const temporaryDirectory = temporaryDirectories.at(-1)!
        const azLogPath = join(temporaryDirectory, 'az-arguments.log')
        const foundryEnvironmentPath = join(repositoryRoot, 'config', 'foundry.environment.default.json')
        await installAzureCliMock(temporaryDirectory, azLogPath, true)

        const result = await executeFile('pwsh', [
            '-NoProfile',
            '-File', scriptPath,
            '-SkipBuild',
            '-SkipHealthCheck',
            '-Confirm:$false',
            '-ArtifactPath', artifactPath,
            '-FoundryEnvironmentPath', foundryEnvironmentPath
        ], {
            env: {
                ...process.env,
                PATH: [temporaryDirectory, process.env.PATH ?? ''].filter(Boolean).join(delimiter)
            }
        })

        expect(`${result.stdout}${result.stderr}`).toContain('App Service completed accepted deployment')
        expect(result.stdout).toContain('Deployment completed')
    }, powershellScriptTimeoutMs)
})

async function installAzureCliMock(temporaryDirectory: string, logPath: string, failDeployment = false) {
    if (process.platform === 'win32') {
        await writeFile(join(temporaryDirectory, 'az.cmd'), mockAzureCliForWindows(logPath, failDeployment), 'utf8')
        return
    }

    const azPath = join(temporaryDirectory, 'az')
    await writeFile(azPath, mockAzureCliForPosix(logPath, failDeployment), 'utf8')
    await chmod(azPath, 0o755)
}

function mockAzureCliForWindows(logPath: string, failDeployment = false) {
    const deploymentStatePath = `${logPath}.deployment-state`
    const deployResponse = failDeployment
        ? `type nul >"${deploymentStatePath}" && echo Simulated gateway failure 1>&2 && exit /b 1`
        : 'echo {} && exit /b 0'
    const deploymentListResponse = failDeployment
        ? `if exist "${deploymentStatePath}" (echo [{"id":"accepted-deployment","status":4,"status_text":""}]) else (echo [])`
        : 'echo []'
    return `@echo off
echo %*>>"${logPath}"
echo %* | findstr /C:"account show" >nul && echo {"tenantId":"72f988bf-86f1-41af-91ab-2d7cd011db47"} && exit /b 0
echo %* | findstr /C:"appservice plan show" >nul && echo {"name":"ASP-myDemoRg-94e3"} && exit /b 0
echo %* | findstr /C:"webapp show" >nul && echo {"defaultHostName":"tlc-frfwf5g4g8edhcc0.westus3-01.azurewebsites.net","kind":"app,linux"} && exit /b 0
echo %* | findstr /C:"webapp log deployment list" >nul && goto deployment_list
echo %* | findstr /C:"webapp deploy" >nul && ${deployResponse}
echo {}
exit /b 0
:deployment_list
${deploymentListResponse}
exit /b 0
`
}

function mockAzureCliForPosix(logPath: string, failDeployment = false) {
    const deploymentStatePath = `${logPath}.deployment-state`
    const deployResponse = failDeployment
        ? `: >"${deploymentStatePath}" && echo "Simulated gateway failure" 1>&2 && exit 1`
        : 'echo "{}" && exit 0'
    const deploymentListResponse = failDeployment
        ? `if [ -f "${deploymentStatePath}" ]; then echo '[{"id":"accepted-deployment","status":4,"status_text":""}]'; else echo '[]'; fi`
        : "echo '[]'"

    return `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >>"${logPath}"
[[ "$*" == *"account show"* ]] && echo '{"tenantId":"72f988bf-86f1-41af-91ab-2d7cd011db47"}' && exit 0
[[ "$*" == *"appservice plan show"* ]] && echo '{"name":"ASP-myDemoRg-94e3"}' && exit 0
[[ "$*" == *"webapp show"* ]] && echo '{"defaultHostName":"tlc-frfwf5g4g8edhcc0.westus3-01.azurewebsites.net","kind":"app,linux"}' && exit 0
[[ "$*" == *"webapp log deployment list"* ]] && { ${deploymentListResponse}; exit 0; }
[[ "$*" == *"webapp deploy"* ]] && { ${deployResponse}; }
echo '{}'
exit 0
`
}

async function createArtifact(populate: (zip: JSZip) => Promise<void> | void) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tlc-deploy-script-test-'))
    temporaryDirectories.push(temporaryDirectory)
    const artifactPath = join(temporaryDirectory, 'app.zip')
    const zip = new JSZip()
    await populate(zip)
    await writeFile(artifactPath, await zip.generateAsync({ type: 'nodebuffer' }))
    return artifactPath
}