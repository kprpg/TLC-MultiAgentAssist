import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createTeamsManifest } from '../../../scripts/package-teams.mjs'

const execute = promisify(execFile)
// Windows temp paths are 8.3 short (RUNNER~1); the PowerShell scripts under test expand them via GetFullPath.
const temporaryRoot = realpathSync.native(tmpdir())
const root = resolve(import.meta.dirname, '../../..')
const script = join(root, 'scripts', 'run-teams-local.ps1')
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function fixture(scenario = 'success', origin = 'https://tlc.testing.contoso.net') {
  const native = ['native', 'cli'].includes(scenario)
  const authentication = scenario === 'cli' ? 'local-azure-cli' : 'local-interactive'
  const folder = await mkdtemp(join(temporaryRoot, 'tlc-teams-runner-'))
  folders.push(folder)
  const runtime = new JSZip()
  runtime.file('server.js', native
    ? `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.TLC_TEST_RUNNER_TRACE, JSON.stringify({phase:'owner-prepare', arguments:process.argv.slice(2)})+'\\n');`
    : 'export {}')
  runtime.file('package.json', JSON.stringify({ name: '@tlc/teams-release', version: '0.1.0' }))
  runtime.file('client/index.html', '<title>TLC Assist for Teams</title>')
  runtime.file('client/build.json', JSON.stringify({ contractVersion: '1.0', buildId: '22222222-2222-4222-8222-222222222222' }))
  runtime.file('.generated-teams-runtime', 'TLC_TEAMS_GENERATED_RUNTIME')
  const runtimeZip = join(folder, 'runtime.zip')
  await writeFile(runtimeZip, await runtime.generateAsync({ type: 'nodebuffer' }))
  const app = new JSZip()
  app.file('manifest.json', JSON.stringify(createTeamsManifest({ mode: native ? 'live' : 'sample', ...(native ? { authentication } : {}), origin, appId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b' })))
  app.file('color.png', 'fixture')
  app.file('outline.png', 'fixture')
  const appZip = join(folder, 'teams.zip')
  await writeFile(appZip, await app.generateAsync({ type: 'nodebuffer' }))
  const config = join(folder, 'private.env')
  await writeFile(config, native
    ? `TLC_TEAMS_MODE=live\nTLC_TEAMS_AUTH_MODE=${authentication}\nTLC_TEAMS_PACKAGE_ID=8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b\n`
    : 'TLC_TEAMS_MODE=sample\nTLC_TEAMS_API_CREDENTIAL=private-fixture-must-not-log\n')
  const trace = join(folder, 'calls.jsonl')
  const wrapper = join(folder, 'invoke.ps1')
  await writeFile(wrapper, `
$ErrorActionPreference = 'Stop'
function Record($value) { Add-Content -LiteralPath $env:TLC_TEST_RUNNER_TRACE -Value ($value | ConvertTo-Json -Depth 6 -Compress) }
function Assert-InstallArguments {
  param([object[]]$Values)
  $interactive = [Array]::IndexOf($Values, '--interactive')
  if ($interactive -ge 0 -and $Values[$interactive + 1] -eq 'true') {
    throw 'ATK interactive mode discards --file-path. Install requires --interactive false.'
  }
  $file = [Array]::IndexOf($Values, '--file-path')
  if ($file -lt 0 -or (Get-FileHash -LiteralPath $Values[$file + 1]).Hash -ne (Get-FileHash -LiteralPath $env:TLC_TEST_RUNNER_APP).Hash -or
      -not ([string]$Values[$file + 1]).StartsWith((Join-Path $env:TLC_TEST_RUNNER_WORK 'packages'))) {
    throw 'ATK install requires the exact verified Teams package path.'
  }
}
function npm {
  Record @{ phase = $(if ($args[0] -eq 'exec') { 'upload' } else { 'build' }); arguments = @($args) }
  if ($args[0] -eq 'exec') { Assert-InstallArguments -Values @($args) }
  $global:LASTEXITCODE = if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'build-failure') { 23 } else { 0 }
}
function atk {
  Record @{ phase = 'upload'; arguments = @($args) }
  Assert-InstallArguments -Values @($args)
  $global:LASTEXITCODE = if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'upload-failure') { 19 } else { 0 }
}
function Read-Host {
  param($Prompt)
  Record @{ phase = 'menu'; prompt = $Prompt }
  if ($Prompt.Contains('INSTALLED')) { return $env:TLC_TEST_RUNNER_CONFIRMATION }
  return $env:TLC_TEST_RUNNER_SELECTION
}
function Get-NetTCPConnection {
  param($LocalPort, $State)
  if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'occupied-port') { return [pscustomobject]@{ OwningProcess = 42 } }
  return @()
}
function Start-Process {
  param($FilePath, $ArgumentList, $WorkingDirectory, $Environment, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError, $WindowStyle)
  if (-not $Environment) { Record @{ phase = 'open'; path = $FilePath }; return }
  $script:launchedWriteMode = $Environment['TLC_TEAMS_CLI_WRITE_MODE']
  $script:launchEnvironment = $Environment
  Record @{ phase = 'start'; directory = $WorkingDirectory; arguments = $ArgumentList; origin = $Environment.TLC_TEAMS_ORIGIN; mode = $Environment.TLC_TEAMS_MODE; authentication = $Environment.TLC_TEAMS_AUTH_MODE; writeMode = $Environment['TLC_TEAMS_CLI_WRITE_MODE']; ownerDirectory = $Environment['TLC_TEAMS_OWNER_DIRECTORY']; host = $Environment.TLC_TEAMS_HOST; data = $Environment.TLC_TEAMS_DATA_DIR; certificate = $Environment['TLC_TEAMS_TLS_CERT_PATH']; privateKey = $Environment['TLC_TEAMS_TLS_KEY_PATH'] }
  return [pscustomobject]@{ Id = 2147483000; StartTime = [DateTime]::UtcNow; HasExited = $false }
}
function Stop-Process { param($Id) Record @{ phase = 'stop'; id = $Id } }
function Get-Process {
  param($Id)
  $record = Get-Content -LiteralPath (Join-Path $env:TLC_TEST_RUNNER_WORK 'current-run.json') -Raw | ConvertFrom-Json
  $time = ([DateTimeOffset]$record.startTimeUtc).UtcDateTime
  if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'reused-pid') { $time = $time.AddHours(1) }
  $process = [pscustomobject]@{ Id = 2147483000; StartTime = $time }
  return ($process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {} -PassThru)
}
function Get-CimInstance {
  param($ClassName, $Filter)
  $record = Get-Content -LiteralPath (Join-Path $env:TLC_TEST_RUNNER_WORK 'current-run.json') -Raw | ConvertFrom-Json
  $runtimeDirectory = [IO.Path]::GetFullPath([string] $record.runtimeDirectory)
  return [pscustomobject]@{ CommandLine = 'node "' + (Join-Path $runtimeDirectory 'server.js') + '"' }
}
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'non-html') { function Start-Sleep { param($Seconds) } }
function Invoke-WebRequest {
  param($Uri, $TimeoutSec, $MaximumRedirection, [switch]$SkipHttpErrorCheck)
  Record @{ phase = 'probe'; uri = [string]$Uri }
  if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'tls-failure' -and ([string]$Uri).StartsWith('https:')) { throw 'Synthetic TLS certificate validation failed' }
  if (([string]$Uri).EndsWith('/api/teams/launch')) {
    $record = Get-Content -LiteralPath (Join-Path $env:TLC_TEST_RUNNER_WORK 'current-run.json') -Raw | ConvertFrom-Json
    return [pscustomobject]@{ StatusCode=200; Content=(@{
      contractVersion='1.0'; runId=$record.runId; clientBuildId=$record.clientBuildId; packageId=$record.packageId
      packageVersion=$record.packageVersion; origin=$record.origin; mode=$record.mode; authentication=$record.authentication
      clients=@(if ($env:TLC_TEST_RUNNER_CLIENT_READY -eq 'true') { @{ host='teams'; checkedAt=[DateTime]::UtcNow.ToString('o') } })
    } | ConvertTo-Json -Depth 6 -Compress) }
  }
  if (([string]$Uri).EndsWith('/api/teams/session')) { return [pscustomobject]@{ StatusCode=401; Content='{"error":"authorization_required"}' } }
  if (([string]$Uri).EndsWith('/api/teams/config')) {
    $profile = if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'cli') { 'local-azure-cli' } else { 'local-interactive' }
    $version = if ($profile -eq 'local-azure-cli') { '1.2' } else { '1.0' }
    $writeMode = $script:launchedWriteMode
    return [pscustomobject]@{ StatusCode=200; Content=(@{ mode='live'; authentication=$profile; contractVersion=$version; writeMode=$writeMode } | ConvertTo-Json -Compress) }
  }
  $content = if (([string]$Uri).EndsWith('/api/health')) { '{"status":"ready","surface":"teams","mode":"sample"}' } else { '<!doctype html><title>TLC Assist for Teams</title><div id="root"></div>' }
  if ($env:TLC_TEST_RUNNER_SCENARIO -in @('native','cli')) { $content = $content.Replace('"mode":"sample"','"mode":"live"') }
  $contentType = if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'non-html') { 'application/json; charset=utf-8' } else { 'text/html; charset=utf-8' }
  return [pscustomobject]@{ StatusCode = 200; Content = $content; Headers = @{ 'Content-Type' = @($contentType) } }
}
$arguments = @{
  Origin = $env:TLC_TEST_RUNNER_ORIGIN
  ConfigPath = $env:TLC_TEST_RUNNER_CONFIG
  WorkDirectory = $env:TLC_TEST_RUNNER_WORK
  RuntimeArchive = $env:TLC_TEST_RUNNER_RUNTIME
  TeamsArchive = $env:TLC_TEST_RUNNER_APP
  LocalPort = 49199
  NoGuide = $true
}
if ($env:TLC_TEST_RUNNER_CERTIFICATE) { $arguments.CertificatePath = $env:TLC_TEST_RUNNER_CERTIFICATE }
if ($env:TLC_TEST_RUNNER_PRIVATE_KEY) { $arguments.PrivateKeyPath = $env:TLC_TEST_RUNNER_PRIVATE_KEY }
if ($env:TLC_TEST_RUNNER_MODE -ne 'menu') { $arguments.Mode = $env:TLC_TEST_RUNNER_MODE }
if ($env:TLC_TEST_RUNNER_WRITE_MODE) { $arguments.CliWriteMode = $env:TLC_TEST_RUNNER_WRITE_MODE }
if ($env:TLC_TEST_RUNNER_SCENARIO -ne 'build-failure') { $arguments.SkipBuild = $true }
else { $arguments.Remove('RuntimeArchive'); $arguments.Remove('TeamsArchive') }
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'no-upload') { $arguments.SkipTeamsUpload = $true }
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'native') { $arguments.AuthMode = 'local-interactive'; $arguments.SkipTeamsUpload = $true }
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'cli') { $arguments.AuthMode = 'local-azure-cli'; $arguments.SkipTeamsUpload = $true }
if ($env:TLC_TEST_RUNNER_AUTH_MODE -eq 'auto') { $arguments.Remove('AuthMode') }
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'tool-bootstrap') { Remove-Item Function:atk }
if ($env:TLC_TEST_RUNNER_SCENARIO -in @('owned-stop', 'reused-pid')) { $arguments = @{ Stop = $true; WorkDirectory = $env:TLC_TEST_RUNNER_WORK } }
if ($env:TLC_TEST_RUNNER_ACTION -eq 'Status') { $arguments = @{ Status = $true; WorkDirectory = $env:TLC_TEST_RUNNER_WORK } }
if ($env:TLC_TEST_RUNNER_ACTION -eq 'Resume') { $arguments = @{ Resume = $true; NoGuide = $true; WorkDirectory = $env:TLC_TEST_RUNNER_WORK } }
if ($env:TLC_TEST_RUNNER_GUIDE -eq 'true') { $arguments.Remove('NoGuide'); $arguments.ClientTimeoutSeconds = 1 }
if ($env:TLC_TEST_RUNNER_MANUAL_UPLOAD -eq 'true') { $arguments.ManualUpload = $true }
if ($env:TLC_TEST_RUNNER_REINSTALL -eq 'true') { $arguments.Reinstall = $true }
try {
  & $env:TLC_TEST_RUNNER_SCRIPT @arguments
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`, 'utf8')
  if (['owned-stop', 'reused-pid'].includes(scenario)) {
    const runtimeDirectory = join(folder, 'owned', 'releases', 'verified-run')
    await mkdir(runtimeDirectory, { recursive: true })
    await writeFile(join(runtimeDirectory, '.runner-owner'), 'verified-run')
    await writeFile(join(runtimeDirectory, 'server.js'), 'fixture')
    await writeFile(join(folder, 'owned', 'current-run.json'), JSON.stringify({
      pid: 2147483000, runtimeDirectory, runId: 'verified-run', startTimeUtc: '2026-10-17T20:00:00.0000000Z'
    }))
    await writeFile(join(folder, 'owned', 'private-state-must-survive'), 'retained')
  }
  const localAppData = join(folder, 'local-app-data')
  const run = (overrideOrigin = origin, tls: { certificate?: string; privateKey?: string } = {}, options: {
    mode?: 'sample' | 'live' | 'menu' | 'LIVE'; selection?: string; configPath?: string | null
    authMode?: 'auto'; writeMode?: 'read-only' | 'reviewed' | 'READ-ONLY'
    action?: 'Status' | 'Resume'
    guide?: boolean; manualUpload?: boolean; reinstall?: boolean; confirmation?: string; clientReady?: boolean
  } = {}) => execute('pwsh', ['-NoProfile', '-File', wrapper], {
    env: {
      ...process.env, LOCALAPPDATA: localAppData, TLC_TEST_RUNNER_SCRIPT: script, TLC_TEST_RUNNER_TRACE: trace,
      TLC_TEST_RUNNER_SCENARIO: scenario, TLC_TEST_RUNNER_ORIGIN: overrideOrigin,
      TLC_TEST_RUNNER_CONFIG: options.configPath === null ? '' : options.configPath ?? config, TLC_TEST_RUNNER_WORK: join(folder, 'owned'),
      TLC_TEST_RUNNER_RUNTIME: runtimeZip, TLC_TEST_RUNNER_APP: appZip,
      TLC_TEST_RUNNER_CERTIFICATE: tls.certificate ?? '', TLC_TEST_RUNNER_PRIVATE_KEY: tls.privateKey ?? '',
      TLC_TEST_RUNNER_MODE: options.mode ?? (native ? 'live' : 'sample'),
      TLC_TEST_RUNNER_SELECTION: options.selection ?? '',
      TLC_TEST_RUNNER_AUTH_MODE: options.authMode ?? '',
      TLC_TEST_RUNNER_WRITE_MODE: options.writeMode ?? '',
      TLC_TEST_RUNNER_ACTION: options.action ?? '',
      TLC_TEST_RUNNER_GUIDE: String(options.guide ?? false),
      TLC_TEST_RUNNER_MANUAL_UPLOAD: String(options.manualUpload ?? false),
      TLC_TEST_RUNNER_REINSTALL: String(options.reinstall ?? false),
      TLC_TEST_RUNNER_CONFIRMATION: options.confirmation ?? '',
      TLC_TEST_RUNNER_CLIENT_READY: String(options.clientReady ?? false)
    }, timeout: 45_000
  })
  const calls = async () => (await readFile(trace, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
  return { folder, localAppData, run, calls, appZip, config }
}

describe('one local build/configure/run/Teams-upload entrypoint', () => {
  it('offers Sample/Live selection instead of a mandatory Origin prompt and discovers the standard localhost certificate pair', async () => {
    const data = await fixture('success', 'https://localhost:49199')
    const certs = join(data.localAppData, 'TLC-Assist', 'Teams', 'certs')
    await mkdir(certs, { recursive: true })
    await writeFile(join(certs, 'localhost.pem'), 'fixture certificate')
    await writeFile(join(certs, 'localhost-key.pem'), 'fixture private key')
    const result = await data.run('', {}, { mode: 'menu', configPath: null })
    const calls = await data.calls()
    expect(calls[0]).toMatchObject({ phase: 'menu' })
    expect(calls.find((entry) => entry.phase === 'start')).toMatchObject({
      mode: 'sample', origin: 'https://localhost:49199', authentication: 'hosted-obo',
      certificate: join(certs, 'localhost.pem'), privateKey: join(certs, 'localhost-key.pem')
    })
    expect(result.stdout).toContain('Starting Teams in sample mode')
  }, 60_000)
  it.runIf(process.platform === 'win32')('discovers the private CLI configuration and launches menu-selected live with reviewed read/write, never source sign-in', async () => {
    const data = await fixture('cli', 'https://localhost:49199')
    const configurationDirectory = join(data.localAppData, 'TLC-Assist', 'Teams', 'configuration')
    await mkdir(configurationDirectory, { recursive: true })
    await writeFile(join(configurationDirectory, 'cli.env'), `${await readFile(data.config, 'utf8')}TLC_TEAMS_ORIGIN=https://localhost:49199\n`)
    const tls = { certificate: join(data.folder, 'certificate.pem'), privateKey: join(data.folder, 'key.pem') }
    await writeFile(tls.certificate, 'fixture certificate')
    await writeFile(tls.privateKey, 'fixture key')
    const result = await data.run('', tls, { mode: 'menu', selection: '2', configPath: null, authMode: 'auto' })
    expect((await data.calls()).find((entry) => entry.phase === 'start')).toMatchObject({
      mode: 'live', authentication: 'local-azure-cli', writeMode: 'reviewed', origin: 'https://localhost:49199'
    })
    expect(result.stdout).toContain('sign-in has NOT occurred')
    expect(JSON.stringify(await data.calls())).not.toContain('"connect"')
  }, 60_000)
  it.runIf(process.platform === 'win32')('opens Sample first while preparing the configured Live profile for a later in-app switch without source sign-in', async () => {
    const data = await fixture('cli', 'https://localhost:49199')
    const tls = { certificate: join(data.folder, 'certificate.pem'), privateKey: join(data.folder, 'key.pem') }
    await writeFile(tls.certificate, 'fixture certificate')
    await writeFile(tls.privateKey, 'fixture key')
    const result = await data.run(undefined, tls, { mode: 'sample', authMode: 'auto' })
    const record = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(record).toMatchObject({ mode: 'live', initialDataMode: 'sample', authentication: 'local-azure-cli' })
    expect((await data.calls()).find((entry) => entry.phase === 'start')).toMatchObject({ mode: 'live', authentication: 'local-azure-cli' })
    expect(result.stdout).toContain('Initial data mode: sample')
    expect(result.stdout).toContain('Sample setup requires no source connection or pairing')
    expect(JSON.stringify(await data.calls())).not.toContain('"connect"')
  }, 60_000)
  it.runIf(process.platform === 'win32').each(['parameter', 'configuration'] as const)('honors read-only CLI mode from %s without silently enabling writes', async (source) => {
    const data = await fixture('cli', 'https://localhost:49199')
    const tls = { certificate: join(data.folder, 'certificate.pem'), privateKey: join(data.folder, 'key.pem') }
    await writeFile(tls.certificate, 'fixture certificate')
    await writeFile(tls.privateKey, 'fixture key')
    if (source === 'configuration') await appendFile(data.config, 'TLC_TEAMS_CLI_WRITE_MODE=read-only\n')
    await data.run(undefined, tls, source === 'parameter' ? { mode: 'LIVE', writeMode: 'READ-ONLY' } : {})
    expect((await data.calls()).find((entry) => entry.phase === 'start')).toMatchObject({ writeMode: 'read-only' })
    expect((await data.calls()).some((entry) => entry.phase === 'menu')).toBe(false)
  }, 60_000)
  it('uses a configured origin when omitted and gives an explicit parameter precedence', async () => {
    const data = await fixture()
    await appendFile(data.config, 'TLC_TEAMS_ORIGIN=https://tlc.testing.contoso.net\n')
    await data.run('')
    expect((await data.calls()).find((entry) => entry.phase === 'start')).toMatchObject({ origin: 'https://tlc.testing.contoso.net' })
    await expect(data.run('https://other.testing.contoso.net')).rejects.toMatchObject({ stderr: expect.stringContaining('URLs/domains') })
  }, 60_000)
  it('does not fall back to sample when live configuration is absent', async () => {
    const data = await fixture()
    await expect(data.run('', {}, { mode: 'live', configPath: null })).rejects.toMatchObject({ stderr: expect.stringContaining('requires a configured environment file') })
    await expect(data.calls()).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60_000)
  it('rejects an invalid menu choice without building, starting or selecting live implicitly', async () => {
    const data = await fixture()
    await expect(data.run('', {}, { mode: 'menu', selection: 'wrong' })).rejects.toMatchObject({ stderr: expect.stringContaining('Select Sample (1) or Live (2)') })
    expect((await data.calls()).map((entry) => entry.phase)).toEqual(['menu'])
  }, 60_000)
  it.runIf(process.platform === 'win32').each(['native', 'cli'])('prepares a private %s installation on the exact frontend port without connecting or writing to MSX', async (profile) => {
    const data = await fixture(profile, 'https://localhost:49199')
    const certificate = join(data.folder, 'certificate.pem')
    const privateKey = join(data.folder, 'private-key.pem')
    await writeFile(certificate, 'fixture certificate')
    await writeFile(privateKey, 'fixture key')
    const result = await data.run(undefined, { certificate, privateKey })
    const calls = await data.calls()
    expect(calls[0]).toMatchObject({ phase: 'owner-prepare', arguments: ['--local-owner', 'prepare', join(data.folder, 'owned', 'private')] })
    const started = calls.find((item) => item.phase === 'start')
    expect(started).toMatchObject({ mode: 'live', authentication: profile === 'cli' ? 'local-azure-cli' : 'local-interactive', origin: 'https://localhost:49199', ownerDirectory: join(data.folder, 'owned', 'private'), data: join(data.folder, 'owned', 'private', 'data') })
    expect(calls.filter((item) => item.phase === 'probe').every((item) => String(item.uri).startsWith('https://localhost:49199/'))).toBe(true)
    expect(result.stdout).toContain('sign-in has NOT occurred')
    expect(JSON.stringify(calls)).not.toContain('"connect"')
    expect(calls.some((item) => item.phase === 'upload')).toBe(false)
  }, 45_000)
  it('extracts the runtime, preserves private configuration outside the archive, verifies HTTPS, then uploads the exact app ZIP', async () => {
    const fixtureData = await fixture()
    const result = await fixtureData.run()
    const calls = await fixtureData.calls()
    expect(calls.map((item) => item.phase)).toEqual(['start', 'probe', 'probe', 'probe', 'probe', 'probe', 'probe', 'upload'])
    const started = calls[0]!
    expect(started).toMatchObject({ host: '127.0.0.1', mode: 'sample', origin: 'https://tlc.testing.contoso.net' })
    expect(await readFile(join(String(started.directory), 'server.js'), 'utf8')).toBe('export {}')
    await expect(readFile(join(String(started.directory), 'runtime.env'))).rejects.toMatchObject({ code: 'ENOENT' })
    const record = JSON.parse(await readFile(join(fixtureData.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(calls.at(-1)?.arguments).toEqual(['install', '--file-path', record.teamsArchive, '--scope', 'Personal', '--interactive', 'false', '--telemetry', 'false'])
    expect(record.teamsArchive).not.toBe(fixtureData.appZip)
    expect(result.stdout).toContain('Rendering, source connection and page pairing are NOT verified')
    expect(`${result.stdout}${result.stderr}`).not.toContain('private-fixture-must-not-log')
  }, 60_000)
  it('does not upload or claim completion when HTTPS fails, and stops only its newly started process', async () => {
    const fixtureData = await fixture('tls-failure')
    await expect(fixtureData.run()).rejects.toMatchObject({ stderr: expect.stringMatching(/HTTPS|TLS/) })
    const calls = await fixtureData.calls()
    expect(calls.some((item) => item.phase === 'upload')).toBe(false)
    expect(calls.at(-1)).toEqual({ phase: 'stop', id: 2147483000 })
  }, 60_000)
  it('rejects a non-HTML content type before uploading even when the response includes the expected title', async () => {
    const fixtureData = await fixture('non-html')
    await expect(fixtureData.run()).rejects.toMatchObject({ stderr: expect.stringContaining('HTTPS/runtime verification failed') })
    const calls = await fixtureData.calls()
    expect(calls.some((item) => item.phase === 'upload')).toBe(false)
    expect(calls.at(-1)).toEqual({ phase: 'stop', id: 2147483000 })
  }, 60_000)
  it('retains an accurately tracked running runtime when tenant upload fails and surfaces the failure', async () => {
    const fixtureData = await fixture('upload-failure')
    await expect(fixtureData.run()).rejects.toMatchObject({ stderr: expect.stringMatching(/upload|install|19/) })
    const calls = await fixtureData.calls()
    expect(calls.at(-1)?.phase).toBe('upload')
    expect(calls.some((item) => item.phase === 'stop')).toBe(false)
    expect(JSON.parse(await readFile(join(fixtureData.folder, 'owned', 'current-run.json'), 'utf8')).pid).toBe(2147483000)
  }, 60_000)
  it('offers an explicit no-upload mode for local validation, not a success-shaped install', async () => {
    const fixtureData = await fixture('no-upload')
    const result = await fixtureData.run()
    expect((await fixtureData.calls()).some((item) => item.phase === 'upload')).toBe(false)
    expect(result.stdout).toContain('Teams upload skipped')
    expect(result.stdout).not.toContain('Teams upload/install completed')
  }, 60_000)
  it('stops the pipeline on a build failure before starting a runtime or changing Teams', async () => {
    const fixtureData = await fixture('build-failure')
    await expect(fixtureData.run()).rejects.toMatchObject({ stderr: expect.stringMatching(/23|build|release/) })
    expect((await fixtureData.calls()).map((item) => item.phase)).toEqual(['build'])
  }, 60_000)
  it('rejects HTTPS localhost without supplied TLS instead of repeating the HTTP/HTTPS blank-window setup', async () => {
    const fixtureData = await fixture()
    await expect(fixtureData.run('https://localhost:49199')).rejects.toMatchObject({ stderr: expect.stringMatching(/certificate|TLS|HTTPS localhost/) })
  }, 60_000)
  describe.each(['parameters', 'configuration'] as const)('TLS paths from %s', (source) => {
    it.each([
      { file: 'certificate', kind: 'missing', label: 'certificate', parameter: '-CertificatePath' },
      { file: 'privateKey', kind: 'missing', label: 'private key', parameter: '-PrivateKeyPath' },
      { file: 'certificate', kind: 'directory', label: 'certificate', parameter: '-CertificatePath' },
      { file: 'privateKey', kind: 'directory', label: 'private key', parameter: '-PrivateKeyPath' }
    ] as const)('rejects $kind $file paths before building, starting or uploading', async ({ file, kind, label, parameter }) => {
      const fixtureData = await fixture('build-failure', 'https://localhost:49199')
      const tls = {
        certificate: join(fixtureData.folder, 'localhost.pem'),
        privateKey: join(fixtureData.folder, 'localhost-key.pem')
      }
      await writeFile(tls[file === 'certificate' ? 'privateKey' : 'certificate'], 'fixture')
      if (kind === 'directory') await mkdir(tls[file])
      if (source === 'configuration') {
        await appendFile(fixtureData.config, `TLC_TEAMS_TLS_CERT_PATH=${tls.certificate}\nTLC_TEAMS_TLS_KEY_PATH=${tls.privateKey}\n`)
      }
      const result = fixtureData.run(undefined, source === 'parameters' ? tls : {})
      await expect(result).rejects.toMatchObject({ stderr: expect.stringContaining(`TLS ${label} file not found:`) })
      await expect(result).rejects.toMatchObject({ stderr: expect.stringContaining(parameter) })
      await expect(fixtureData.calls()).rejects.toMatchObject({ code: 'ENOENT' })
    }, 60_000)
    it('passes existing certificate and key files with literal paths to the runtime', async () => {
      const fixtureData = await fixture('success', 'https://localhost:49199')
      const directory = join(fixtureData.folder, 'TLS files [local]')
      await mkdir(directory)
      const tls = {
        certificate: join(directory, 'localhost.pem'),
        privateKey: join(directory, 'localhost-key.pem')
      }
      await writeFile(tls.certificate, 'certificate fixture')
      await writeFile(tls.privateKey, 'private key fixture')
      if (source === 'configuration') {
        await appendFile(fixtureData.config, `TLC_TEAMS_TLS_CERT_PATH=${tls.certificate}\nTLC_TEAMS_TLS_KEY_PATH=${tls.privateKey}\n`)
      }
      await fixtureData.run(undefined, source === 'parameters' ? tls : {})
      expect((await fixtureData.calls())[0]).toMatchObject({ phase: 'start', ...tls })
    }, 60_000)
  })
  it('refuses a foreign occupied port without killing the other server', async () => {
    const fixtureData = await fixture('occupied-port')
    await expect(fixtureData.run()).rejects.toMatchObject({ stderr: expect.stringMatching(/already owned|another process/) })
    await expect(fixtureData.calls()).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60_000)
  it('rejects a ZIP configured for another host before starting or uploading anything', async () => {
    const fixtureData = await fixture()
    await expect(fixtureData.run('https://another.testing.contoso.net')).rejects.toMatchObject({ stderr: expect.stringMatching(/URLs\/domains|origin/) })
    await expect(fixtureData.calls()).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60_000)
  it('bootstraps only the pinned official upload CLI with install scripts disabled, never resource provisioning', async () => {
    const fixtureData = await fixture('tool-bootstrap')
    await fixtureData.run()
    const upload = (await fixtureData.calls()).at(-1)
    const record = JSON.parse(await readFile(join(fixtureData.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(upload?.phase).toBe('upload')
    expect(upload?.arguments).toEqual([
      'exec', '--yes', '--ignore-scripts', '--package=@microsoft/m365agentstoolkit-cli@1.1.18', '--',
      'atk', 'install', '--file-path', record.teamsArchive, '--scope', 'Personal', '--interactive', 'false', '--telemetry', 'false'
    ])
  }, 60_000)
  it('supports direct manual upload without invoking or bootstrapping the CLI and verifies the matching Teams client', async () => {
    const data = await fixture('tool-bootstrap')
    const result = await data.run(undefined, {}, { guide: true, manualUpload: true, confirmation: 'INSTALLED', clientReady: true })
    const calls = await data.calls()
    const record = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(calls.some((entry) => ['upload', 'build', 'stop'].includes(String(entry.phase)))).toBe(false)
    expect(calls.find((entry) => entry.phase === 'open')).toEqual({ phase: 'open', path: join(record.teamsArchive, '..') })
    expect(result.stdout).toContain(record.teamsArchive)
    expect(result.stdout).toContain('Upload a custom app')
    expect(result.stdout).toContain('VERIFIED')
    expect(record).toMatchObject({ installation: 'verified', setup: 'complete' })
  }, 60_000)
  it.each([false, true])('resumes with direct manual upload (Reinstall = %s) without repeating CLI login or restarting the backend', async (reinstall) => {
    const data = await fixture()
    await data.run()
    const before = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    await data.run(undefined, {}, { action: 'Resume', guide: true, manualUpload: true, reinstall, confirmation: 'INSTALLED', clientReady: true })
    const calls = await data.calls()
    expect(calls.filter((entry) => entry.phase === 'start')).toHaveLength(1)
    expect(calls.filter((entry) => entry.phase === 'upload')).toHaveLength(1)
    expect(calls.some((entry) => ['stop', 'build'].includes(String(entry.phase)))).toBe(false)
    expect(calls.find((entry) => entry.phase === 'open')).toEqual({ phase: 'open', path: join(before.teamsArchive, '..') })
    const after = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(after).toMatchObject({ pid: before.pid, runId: before.runId, teamsArchive: before.teamsArchive, installation: 'verified', setup: 'complete' })
  }, 60_000)
  it('keeps manual upload available after CLI failure through the existing recovery menu', async () => {
    const data = await fixture('upload-failure')
    const result = await data.run(undefined, {}, { guide: true, selection: 'M', confirmation: 'INSTALLED', clientReady: true })
    const calls = await data.calls()
    expect(calls.filter((entry) => entry.phase === 'upload')).toHaveLength(1)
    expect(calls.some((entry) => entry.phase === 'open')).toBe(true)
    expect(result.stdout).toContain('-Resume -Reinstall -ManualUpload')
    expect(result.stdout).toContain('AADSTS530084')
    expect(result.stdout).toContain('VERIFIED')
  }, 60_000)
  it('does not treat manual confirmation alone as a verified Teams installation', async () => {
    const data = await fixture('tool-bootstrap')
    await expect(data.run(undefined, {}, { guide: true, manualUpload: true, confirmation: 'INSTALLED' })).rejects.toMatchObject({
      stdout: expect.not.stringContaining('VERIFIED'),
      stderr: expect.stringContaining('no matching Teams client acknowledged')
    })
    const record = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(record).toMatchObject({ installation: 'manually-confirmed', setup: 'backend-ready', verifiedAt: '' })
    expect((await data.calls()).some((entry) => ['upload', 'stop'].includes(String(entry.phase)))).toBe(false)
  }, 60_000)
  it('pauses an unconfirmed manual reinstall without claiming installation or losing the running backend', async () => {
    const data = await fixture()
    await data.run()
    const before = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    await expect(data.run(undefined, {}, { action: 'Resume', guide: true, manualUpload: true })).rejects.toMatchObject({
      stderr: expect.stringContaining('paused before installation confirmation')
    })
    const after = JSON.parse(await readFile(join(data.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(after).toMatchObject({ pid: before.pid, runId: before.runId, installation: 'not-started' })
    const calls = await data.calls()
    expect(calls.filter((entry) => entry.phase === 'upload')).toHaveLength(1)
    expect(calls.some((entry) => entry.phase === 'stop')).toBe(false)
  }, 60_000)
  it.each([
    { scenario: 'success', guide: false },
    { scenario: 'no-upload', guide: true }
  ])('rejects conflicting manual upload options before startup ($scenario, guide = $guide)', async ({ scenario, guide }) => {
    const data = await fixture(scenario)
    await expect(data.run(undefined, {}, { guide, manualUpload: true })).rejects.toMatchObject({
      stderr: expect.stringContaining('cannot be combined')
    })
    await expect(data.calls()).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60_000)
  it.each(['changed', 'missing', 'outside'] as const)('rejects a %s recorded ZIP before opening manual upload', async (condition) => {
    const data = await fixture()
    await data.run()
    const recordPath = join(data.folder, 'owned', 'current-run.json')
    const record = JSON.parse(await readFile(recordPath, 'utf8'))
    if (condition === 'changed') await writeFile(record.teamsArchive, 'changed fixture')
    else if (condition === 'missing') await rm(record.teamsArchive)
    else await writeFile(recordPath, JSON.stringify({ ...record, teamsArchive: data.appZip }))
    await expect(data.run(undefined, {}, { action: 'Resume', guide: true, manualUpload: true })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^The recorded Teams installation ZIP is missing, changed or outside this run\. Rebuild normally; do not upload an unverified ZIP\.\r?\n$/)
    })
    const calls = await data.calls()
    expect(calls.some((entry) => entry.phase === 'open')).toBe(false)
    expect(calls.some((entry) => entry.phase === 'stop')).toBe(false)
    expect(calls.filter((entry) => entry.phase === 'upload')).toHaveLength(1)
    expect(calls.filter((entry) => entry.phase === 'start')).toHaveLength(1)
  }, 60_000)
  it('checks status and resumes installation without building, starting, stopping or selecting a data mode again', async () => {
    const fixtureData = await fixture()
    await fixtureData.run()
    const before = JSON.parse(await readFile(join(fixtureData.folder, 'owned', 'current-run.json'), 'utf8'))
    const status = await fixtureData.run(undefined, {}, { action: 'Status' })
    expect(status.stdout).toContain('waiting')
    expect(status.stdout).toContain('Setup is incomplete')
    await fixtureData.run(undefined, {}, { action: 'Resume' })
    const calls = await fixtureData.calls()
    expect(calls.filter((entry) => entry.phase === 'start')).toHaveLength(1)
    expect(calls.filter((entry) => entry.phase === 'upload')).toHaveLength(1)
    expect(calls.some((entry) => ['stop', 'build', 'menu'].includes(String(entry.phase)))).toBe(false)
    const after = JSON.parse(await readFile(join(fixtureData.folder, 'owned', 'current-run.json'), 'utf8'))
    expect(after.runId).toBe(before.runId)
  }, 60_000)
  it('stops only a verified owned PID and retains data and release files', async () => {
    const fixtureData = await fixture('owned-stop')
    await fixtureData.run()
    expect(await fixtureData.calls()).toEqual([{ phase: 'stop', id: 2147483000 }])
    expect(await readFile(join(fixtureData.folder, 'owned', 'private-state-must-survive'), 'utf8')).toBe('retained')
    await expect(readFile(join(fixtureData.folder, 'owned', 'current-run.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 60_000)
  it('never stops a reused PID even when an old record and ownership marker exist', async () => {
    const fixtureData = await fixture('reused-pid')
    await expect(fixtureData.run()).rejects.toMatchObject({ stderr: expect.stringMatching(/reused PID|unrelated/) })
    await expect(fixtureData.calls()).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(fixtureData.folder, 'owned', 'current-run.json'), 'utf8')).pid).toBe(2147483000)
  }, 60_000)
})
