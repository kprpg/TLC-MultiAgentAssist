import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createTeamsManifest } from '../../../scripts/package-teams.mjs'

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '../../..')
const script = join(root, 'scripts', 'run-teams-local.ps1')
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function fixture(scenario = 'success', origin = 'https://tlc.testing.contoso.net') {
  const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-runner-'))
  folders.push(folder)
  const runtime = new JSZip()
  runtime.file('server.js', 'export {}')
  runtime.file('package.json', JSON.stringify({ name: '@tlc/teams-release', version: '0.1.0' }))
  runtime.file('client/index.html', '<title>TLC Assist for Teams</title>')
  runtime.file('.generated-teams-runtime', 'TLC_TEAMS_GENERATED_RUNTIME')
  const runtimeZip = join(folder, 'runtime.zip')
  await writeFile(runtimeZip, await runtime.generateAsync({ type: 'nodebuffer' }))
  const app = new JSZip()
  app.file('manifest.json', JSON.stringify(createTeamsManifest({ mode: 'sample', origin, appId: '8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b' })))
  app.file('color.png', 'fixture')
  app.file('outline.png', 'fixture')
  const appZip = join(folder, 'teams.zip')
  await writeFile(appZip, await app.generateAsync({ type: 'nodebuffer' }))
  const config = join(folder, 'private.env')
  await writeFile(config, 'TLC_TEAMS_MODE=sample\nTLC_TEAMS_API_CREDENTIAL=private-fixture-must-not-log\n')
  const trace = join(folder, 'calls.jsonl')
  const wrapper = join(folder, 'invoke.ps1')
  await writeFile(wrapper, `
$ErrorActionPreference = 'Stop'
function Record($value) { Add-Content -LiteralPath $env:TLC_TEST_RUNNER_TRACE -Value ($value | ConvertTo-Json -Depth 6 -Compress) }
function npm {
  Record @{ phase = $(if ($args[0] -eq 'exec') { 'upload' } else { 'build' }); arguments = @($args) }
  $global:LASTEXITCODE = if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'build-failure') { 23 } else { 0 }
}
function atk {
  Record @{ phase = 'upload'; arguments = @($args) }
  $global:LASTEXITCODE = if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'upload-failure') { 19 } else { 0 }
}
function Get-NetTCPConnection {
  param($LocalPort, $State)
  if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'occupied-port') { return [pscustomobject]@{ OwningProcess = 42 } }
  return @()
}
function Start-Process {
  param($FilePath, $ArgumentList, $WorkingDirectory, $Environment, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError, $WindowStyle)
  Record @{ phase = 'start'; directory = $WorkingDirectory; arguments = $ArgumentList; origin = $Environment.TLC_TEAMS_ORIGIN; mode = $Environment.TLC_TEAMS_MODE; host = $Environment.TLC_TEAMS_HOST; data = $Environment.TLC_TEAMS_DATA_DIR; certificate = $Environment['TLC_TEAMS_TLS_CERT_PATH']; privateKey = $Environment['TLC_TEAMS_TLS_KEY_PATH'] }
  return [pscustomobject]@{ Id = 2147483000; StartTime = [DateTime]::UtcNow; HasExited = $false }
}
function Stop-Process { param($Id) Record @{ phase = 'stop'; id = $Id } }
function Get-Process {
  param($Id)
  $time = [DateTime]::Parse('2026-10-17T20:00:00Z').ToUniversalTime()
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
  $content = if (([string]$Uri).EndsWith('/api/health')) { '{"status":"ready","surface":"teams","mode":"sample"}' } else { '<!doctype html><title>TLC Assist for Teams</title><div id="root"></div>' }
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
}
if ($env:TLC_TEST_RUNNER_CERTIFICATE) { $arguments.CertificatePath = $env:TLC_TEST_RUNNER_CERTIFICATE }
if ($env:TLC_TEST_RUNNER_PRIVATE_KEY) { $arguments.PrivateKeyPath = $env:TLC_TEST_RUNNER_PRIVATE_KEY }
if ($env:TLC_TEST_RUNNER_SCENARIO -ne 'build-failure') { $arguments.SkipBuild = $true }
else { $arguments.Remove('RuntimeArchive'); $arguments.Remove('TeamsArchive') }
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'no-upload') { $arguments.SkipTeamsUpload = $true }
if ($env:TLC_TEST_RUNNER_SCENARIO -eq 'tool-bootstrap') { Remove-Item Function:atk }
if ($env:TLC_TEST_RUNNER_SCENARIO -in @('owned-stop', 'reused-pid')) { $arguments = @{ Stop = $true; WorkDirectory = $env:TLC_TEST_RUNNER_WORK } }
& $env:TLC_TEST_RUNNER_SCRIPT @arguments
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
  const run = (overrideOrigin = origin, tls: { certificate?: string; privateKey?: string } = {}) => execute('pwsh', ['-NoProfile', '-File', wrapper], {
    env: {
      ...process.env, TLC_TEST_RUNNER_SCRIPT: script, TLC_TEST_RUNNER_TRACE: trace,
      TLC_TEST_RUNNER_SCENARIO: scenario, TLC_TEST_RUNNER_ORIGIN: overrideOrigin,
      TLC_TEST_RUNNER_CONFIG: config, TLC_TEST_RUNNER_WORK: join(folder, 'owned'),
      TLC_TEST_RUNNER_RUNTIME: runtimeZip, TLC_TEST_RUNNER_APP: appZip,
      TLC_TEST_RUNNER_CERTIFICATE: tls.certificate ?? '', TLC_TEST_RUNNER_PRIVATE_KEY: tls.privateKey ?? ''
    }, timeout: 45_000
  })
  const calls = async () => (await readFile(trace, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
  return { folder, run, calls, appZip, config }
}

describe('one local build/configure/run/Teams-upload entrypoint', () => {
  it('extracts the runtime, preserves private configuration outside the archive, verifies HTTPS, then uploads the exact app ZIP', async () => {
    const fixtureData = await fixture()
    const result = await fixtureData.run()
    const calls = await fixtureData.calls()
    expect(calls.map((item) => item.phase)).toEqual(['start', 'probe', 'probe', 'probe', 'probe', 'upload'])
    const started = calls[0]!
    expect(started).toMatchObject({ host: '127.0.0.1', mode: 'sample', origin: 'https://tlc.testing.contoso.net' })
    expect(await readFile(join(String(started.directory), 'server.js'), 'utf8')).toBe('export {}')
    await expect(readFile(join(String(started.directory), 'runtime.env'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls.at(-1)?.arguments).toEqual(['install', '--file-path', fixtureData.appZip, '--scope', 'Personal', '--interactive', 'true', '--telemetry', 'false'])
    expect(result.stdout).toContain('Teams upload/install completed')
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
    expect(upload?.phase).toBe('upload')
    expect(upload?.arguments).toEqual([
      'exec', '--yes', '--ignore-scripts', '--package=@microsoft/m365agentstoolkit-cli@1.1.18', '--',
      'atk', 'install', '--file-path', fixtureData.appZip, '--scope', 'Personal', '--interactive', 'true', '--telemetry', 'false'
    ])
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
