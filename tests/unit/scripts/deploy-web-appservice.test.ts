import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'

const executeFile = promisify(execFile)
const repositoryRoot = resolve(import.meta.dirname, '../../..')
const scriptPath = join(repositoryRoot, 'scripts', 'deploy-web-appservice.ps1')
const authScriptPath = join(repositoryRoot, 'scripts', 'configure-web-easyauth.ps1')
const temporaryDirectories: string[] = []
const healthServers: Server[] = []
const powershellScriptTimeoutMs = 20_000

afterEach(async () => {
    await Promise.all(healthServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => error ? reject(error) : resolve())
    })))
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
            '-Mode', 'easy-auth',
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
            '-Mode', 'easy-auth',
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
            '-Mode', 'easy-auth',
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
            '-Mode', 'easy-auth',
            '-SkipBuild',
            '-SkipHealthCheck',
            '-Confirm:$false',
            '-ArtifactPath', artifactPath,
            '-FoundryEnvironmentPath', foundryEnvironmentPath
        ], {
            env: {
                ...process.env,
                PATH: [temporaryDirectory, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
                TLC_AI_MODE: 'invalid-but-unused-by-live-deployment'
            }
        })

        const azArguments = await readFile(azLogPath, 'utf8')
        expect(azArguments).toContain('webapp config appsettings set')
        expect(azArguments).toContain('--settings TLC_FOUNDRY_ENV_BASE64=')
        expect(azArguments).toContain('WEBSITE_RUN_FROM_PACKAGE=1')
        expect(azArguments).toContain('--track-status false')
        expect(azArguments).not.toContain('--async')
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
            '-Mode', 'easy-auth',
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

describe('App Service health verification', () => {
    it('accepts a ready JSON health response', async () => {
        const { uri, requests } = await startHealthServer([{
            status: 200, contentType: 'application/json; charset=utf-8', body: '{"status":"ready"}'
        }])

        const result = await runHealthCheck(uri)

        expect(result.stdout).toContain('Health check passed')
        expect(requests).toEqual(['/api/health'])
    }, powershellScriptTimeoutMs)

    it.each([301, 302, 307, 308, 401, 403])('reports HTTP %i without following login redirects', async (status) => {
        const { uri, requests } = await startHealthServer([
            { status, contentType: 'text/html', body: 'Sign in', location: '/login?private=do-not-log' },
            { status: 200, contentType: 'application/json', body: '{"status":"ready"}' }
        ])

        await expect(runHealthCheck(uri)).rejects.toMatchObject({
            stderr: expect.stringMatching(new RegExp(`HTTP ${status}[\\s\\S]*\\/api\\/health[\\s\\S]*authentication`))
        })
        expect(requests).toEqual(['/api/health'])
    }, powershellScriptTimeoutMs)

    it.each([
        { contentType: 'text/html', body: '<html>Sign in</html>' },
        { body: '{"status":"ready"}' }
    ])('rejects a response without a JSON content type: %j', async (fixture) => {
        const { uri } = await startHealthServer([{ status: 200, ...fixture }])

        await expect(runHealthCheck(uri)).rejects.toMatchObject({
            stderr: expect.stringContaining('application/json')
        })
    }, powershellScriptTimeoutMs)

    it.each([
        ['invalid JSON', '{private-do-not-log', 'invalid JSON'],
        ['missing status', '{}', 'JSON object with a string status'],
        ['null', 'null', 'JSON object with a string status'],
        ['an array', '[{"status":"ready"}]', 'JSON object with a string status'],
        ['an array status', '{"status":["ready"]}', 'JSON object with a string status'],
        ['a boolean status', '{"status":true}', 'JSON object with a string status'],
        ['a non-ready status', '{"status":"starting"}', "status 'ready'"]
    ])('rejects %s with a useful diagnostic', async (_name, body, diagnostic) => {
        const { uri } = await startHealthServer([{ status: 200, contentType: 'application/json', body }])

        try {
            await runHealthCheck(uri)
            expect.fail('An invalid health response must fail verification')
        } catch (error) {
            expect(error).toMatchObject({ stderr: expect.stringContaining(diagnostic) })
            expect(error).toMatchObject({ stderr: expect.not.stringContaining('private-do-not-log') })
            expect(error).toMatchObject({ stderr: expect.not.stringContaining("The property 'status' cannot be found") })
        }
    }, powershellScriptTimeoutMs)

    it('retries a transient HTTP failure and accepts the ready response', async () => {
        const { uri, requests } = await startHealthServer([
            { status: 503, contentType: 'text/html', body: 'Starting' },
            { status: 200, contentType: 'application/json', body: '{"status":"ready"}' }
        ])

        const result = await runHealthCheck(uri, 2)

        expect(result.stdout).toContain('Health check passed')
        expect(requests).toEqual(['/api/health', '/api/health'])
    }, powershellScriptTimeoutMs)

    it('reports the HTTP status after exhausting the configured attempts', async () => {
        const { uri, requests } = await startHealthServer([
            { status: 503, contentType: 'text/html', body: 'Starting' }
        ])

        await expect(runHealthCheck(uri, 2)).rejects.toMatchObject({
            stderr: expect.stringMatching(/failed after 2 attempts[\s\S]*HTTP 503/)
        })
        expect(requests).toEqual(['/api/health', '/api/health'])
    }, powershellScriptTimeoutMs)
})

describe('Easy Auth health-route configuration', () => {
    it.each([
        [undefined, ['/api/health']],
        [null, ['/api/health']],
        [[], ['/api/health']],
        [['/existing'], ['/existing', '/api/health']],
        [['/existing', '/api/health'], ['/existing', '/api/health']]
    ])('preserves existing exclusions and protects other routes: %j', async (excludedPaths, expected) => {
        const globalValidation = {
            requireAuthentication: true,
            unauthenticatedClientAction: 'RedirectToLoginPage',
            redirectToProvider: 'azureactivedirectory',
            ...(excludedPaths === undefined ? {} : { excludedPaths })
        }
        const result = await executeFile('pwsh', ['-NoProfile', '-Command', `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
${loadPowerShellFunction(authScriptPath, 'Add-HealthEndpointAuthExclusion')}
$validation = '${JSON.stringify(globalValidation)}' | ConvertFrom-Json
Add-HealthEndpointAuthExclusion -GlobalValidation $validation
$validation | ConvertTo-Json -Depth 10 -Compress
`])

        expect(JSON.parse(result.stdout)).toEqual({ ...globalValidation, excludedPaths: expected })
    }, powershellScriptTimeoutMs)
})

interface HealthResponseFixture {
    status: number
    contentType?: string
    body: string
    location?: string
}

async function startHealthServer(fixtures: readonly [HealthResponseFixture, ...HealthResponseFixture[]]) {
    const requests: string[] = []
    const server = createServer((request, response) => {
        requests.push(request.url ?? '')
        const fixture = fixtures[Math.min(requests.length - 1, fixtures.length - 1)] ?? fixtures[0]
        response.writeHead(fixture.status, {
            ...(fixture.contentType ? { 'content-type': fixture.contentType } : {}),
            ...(fixture.location ? { location: fixture.location } : {})
        })
        response.end(fixture.body)
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    healthServers.push(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The health fixture must listen on a TCP port')
    return { uri: `http://127.0.0.1:${address.port}/api/health`, requests }
}

function runHealthCheck(uri: string, attempts = 1) {
    return executeFile('pwsh', ['-NoProfile', '-Command', `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$HealthAttempts = ${attempts}
$HealthDelaySeconds = 0
${loadPowerShellFunction(scriptPath, 'Test-HealthEndpoint')}
Test-HealthEndpoint -Uri '${uri}'
`])
}

function loadPowerShellFunction(path: string, name: string) {
    return `
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${path.replaceAll("'", "''")}', [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count) { throw 'The PowerShell script must parse successfully' }
$definition = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq '${name}'
}, $true)
if ($null -eq $definition) { throw 'The expected PowerShell function was not found' }
. ([scriptblock]::Create($definition.Extent.Text))
`
}

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