import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const helper = resolve(import.meta.dirname, '../../../scripts/teams-launch-session.ps1')
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function fixture(scenario = 'live', code = 'A1B2C3D4') {
  const folder = await mkdtemp(join(tmpdir(), 'tlc-teams-guided-'))
  folders.push(folder)
  const work = join(folder, 'work')
  const runId = '1'.repeat(32)
  const runtime = join(work, 'releases', runId)
  const packageDirectory = join(work, 'packages', runId)
  await mkdir(runtime, { recursive: true })
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(runtime, '.runner-owner'), runId)
  await writeFile(join(runtime, 'server.js'), 'fixture')
  const archive = join(packageDirectory, 'teams.zip')
  await writeFile(archive, 'exact-package-fixture')
  const trace = join(folder, 'trace.jsonl')
  const wrapper = join(folder, 'invoke.ps1')
  await writeFile(wrapper, `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Trace-Launch($value) { Add-Content -LiteralPath $env:TLC_GUIDED_TRACE -Value ($value | ConvertTo-Json -Depth 8 -Compress) }
. $env:TLC_GUIDED_HELPER
$script:connected = $env:TLC_GUIDED_SCENARIO -in @('already-ready', 'resume-hidden', 'account-only')
$script:msxConnected = $script:connected -and $env:TLC_GUIDED_SCENARIO -ne 'account-only'
$script:opened = $env:TLC_GUIDED_SCENARIO -eq 'already-ready'
$script:approved = if ($script:connected) { 'A1B2C3D4' } else { '' }
$sample = $env:TLC_GUIDED_SCENARIO -in @('sample', 'sample-in-live-runtime', 'manual-install', 'install-failure', 'no-guide')
$record = [pscustomobject]@{
  pid=2147483000; startTimeUtc='2026-10-19T20:00:00.0000000Z'
  runId='11111111111111111111111111111111'; runtimeDirectory=$env:TLC_GUIDED_RUNTIME
  origin='https://localhost:49199'; mode=$(if ($sample -and $env:TLC_GUIDED_SCENARIO -ne 'sample-in-live-runtime') { 'sample' } else { 'live' })
  initialDataMode=$(if ($sample) { 'sample' } else { 'live' })
  authentication=$(if ($sample -and $env:TLC_GUIDED_SCENARIO -ne 'sample-in-live-runtime') { 'hosted-obo' } else { 'local-azure-cli' })
  ownerDirectory=(Join-Path $env:TLC_GUIDED_WORK 'private'); logs=(Join-Path $env:TLC_GUIDED_WORK 'logs')
  clientBuildId='22222222-2222-4222-8222-222222222222'; packageId='8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b'
  packageVersion='1.2484.12345'; teamsArchive=$env:TLC_GUIDED_ARCHIVE
  teamsArchiveSha256=(Get-FileHash -LiteralPath $env:TLC_GUIDED_ARCHIVE -Algorithm SHA256).Hash
  installation=$(if ($script:connected) { 'verified' } else { 'not-started' })
  setup='backend-ready'; pairingCode=$script:approved; verifiedAt=''
}
Write-TeamsRunRecord -WorkDirectory $env:TLC_GUIDED_WORK -Record $record
if ($env:TLC_GUIDED_SCENARIO -eq 'tampered-package') { Add-Content -LiteralPath $record.teamsArchive -Value 'changed' }
function Get-Process {
  param($Id)
  if ($env:TLC_GUIDED_SCENARIO -eq 'stopped') { return $null }
  return [pscustomobject]@{ Id=$Id; StartTime=([DateTimeOffset]'2026-10-19T20:00:00Z').UtcDateTime }
}
function Get-CimInstance {
  param($ClassName, $Filter)
  $path = if ($env:TLC_GUIDED_SCENARIO -eq 'foreign-pid') { 'C:\\unrelated\\server.js' } else { Join-Path $env:TLC_GUIDED_RUNTIME 'server.js' }
  return [pscustomobject]@{ CommandLine='node "' + $path + '"' }
}
function Invoke-WebRequest {
  param($Uri, $TimeoutSec, $MaximumRedirection)
  Trace-Launch @{ phase='probe'; uri=[string]$Uri }
  $clients = @()
  if ($script:opened -and ($sample -or $script:approved) -and $env:TLC_GUIDED_SCENARIO -ne 'approval-only') {
    $checkedAt = if ($env:TLC_GUIDED_SCENARIO -eq 'stale-heartbeat') { [DateTime]::UtcNow.AddSeconds(-31) } else { [DateTime]::UtcNow }
    $proof = @{ host=$(if ($env:TLC_GUIDED_SCENARIO -eq 'browser-only') { 'browser' } else { 'teams' }); checkedAt=$checkedAt.ToString('o') }
    if (-not $sample) { $proof.pairingCode=$(if ($env:TLC_GUIDED_SCENARIO -eq 'other-page') { 'DEADBEEF' } else { $script:approved }) }
    $clients += $proof
  }
  return [pscustomobject]@{ StatusCode=200; Content=(@{
    contractVersion='1.0'; runId=$(if ($env:TLC_GUIDED_SCENARIO -eq 'wrong-backend') { '22222222222222222222222222222222' } else { $record.runId })
    clientBuildId=$record.clientBuildId; packageId=$record.packageId; packageVersion=$record.packageVersion
    origin=$record.origin; mode=$record.mode; authentication=$record.authentication; clients=$clients
  } | ConvertTo-Json -Depth 8 -Compress) }
}
function atk {
  Trace-Launch @{ phase='install'; arguments=@($args) }
  $global:LASTEXITCODE = if ($env:TLC_GUIDED_SCENARIO -in @('manual-install', 'install-failure')) { 19 } else { 0 }
}
function Start-Process {
  param($FilePath)
  Trace-Launch @{ phase='open'; target=$FilePath }
  if ($FilePath.StartsWith('https://teams.microsoft.com/')) { $script:opened=$true }
}
function Read-Host {
  param($Prompt)
  Trace-Launch @{ phase='prompt'; text=$Prompt }
  if ($Prompt.StartsWith('Type CONNECT')) { return $(if ($env:TLC_GUIDED_SCENARIO -eq 'decline-connect') { 'Q' } else { 'CONNECT' }) }
  if ($Prompt.StartsWith('Enter the exact')) { return $(if ($env:TLC_GUIDED_SCENARIO -eq 'resume-hidden') { '' } else { $env:TLC_GUIDED_CODE }) }
  if ($Prompt.StartsWith('R =')) { return $(if ($env:TLC_GUIDED_SCENARIO -eq 'manual-install') { 'M' } else { 'Q' }) }
  if ($Prompt.StartsWith('After Teams accepts')) { return 'INSTALLED' }
  throw 'Unexpected prompt'
}
function Invoke-TeamsRunOwner {
  param($WorkDirectory, $Action, $UserCode)
  Trace-Launch @{ phase='owner'; action=$Action; code=$UserCode; work=$WorkDirectory }
  if ($Action -eq 'Connect') { $script:connected=$true; $script:msxConnected=$true }
  if ($Action -eq 'Approve') {
    if ($UserCode -ne 'A1B2C3D4') { throw 'local_pairing_expired: wrong page code' }
    $script:approved=$UserCode
  }
  return [pscustomobject]@{
    contractVersion='1.0'; ok=$true; pending=@()
    status=[pscustomobject]@{
      state=$(if ($script:connected) { 'connected' } else { 'sign-in-required' })
      account='private-owner-must-not-log'; resources=@([pscustomobject]@{ resource='msx'; state=$(if ($script:msxConnected) { 'connected' } else { 'not-connected' }) })
    }
  }
}
try {
  Complete-TeamsRunSetup -WorkDirectory $env:TLC_GUIDED_WORK -ClientTimeoutSeconds 1 -NoGuide:($env:TLC_GUIDED_SCENARIO -eq 'no-guide')
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`)
  const run = () => execute('pwsh', ['-NoProfile', '-File', wrapper], {
    env: {
      ...process.env, TLC_GUIDED_HELPER: helper, TLC_GUIDED_SCENARIO: scenario, TLC_GUIDED_CODE: code,
      TLC_GUIDED_WORK: work, TLC_GUIDED_RUNTIME: runtime, TLC_GUIDED_ARCHIVE: archive, TLC_GUIDED_TRACE: trace
    }, timeout: 30_000
  })
  const calls = async () => (await readFile(trace, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
  const record = async () => JSON.parse(await readFile(join(work, 'current-run.json'), 'utf8')) as Record<string, unknown>
  return { run, calls, record, work, archive }
}

describe('guided Teams installation and finish-line verification', () => {
  it('installs the exact client, opens its Teams identity, explicitly connects and approves only the entered page code', async () => {
    const data = await fixture()
    const result = await data.run()
    const calls = await data.calls()
    expect(calls.find((call) => call.phase === 'install')?.arguments).toEqual([
      'install', '--file-path', data.archive, '--scope', 'Personal', '--interactive', 'false', '--telemetry', 'false'
    ])
    expect(calls.find((call) => call.phase === 'open')?.target).toBe('https://teams.microsoft.com/l/entity/8cb8c9a2-6ee6-4382-bfa4-5b409c77e54b/tlc-personal?webjoin=true')
    const actions = calls.filter((call) => call.phase === 'owner')
    expect(actions.filter((call) => call.action === 'Connect')).toHaveLength(1)
    expect(actions.find((call) => call.action === 'Approve')).toMatchObject({ code: 'A1B2C3D4', work: data.work })
    expect(calls.findIndex((call) => call.phase === 'prompt' && String(call.text).startsWith('Type CONNECT'))).toBeLessThan(calls.findIndex((call) => call.action === 'Connect'))
    expect(await data.record()).toMatchObject({ installation: 'verified', setup: 'complete', pairingCode: 'A1B2C3D4' })
    expect(result.stdout).toContain('VERIFIED: the latest packaged Teams client')
    expect(`${result.stdout}${result.stderr}`).not.toContain('private-owner-must-not-log')
  }, 40_000)
  it('finishes sample setup without any source or owner action', async () => {
    const data = await fixture('sample')
    await data.run()
    expect((await data.calls()).some((call) => call.phase === 'owner')).toBe(false)
    expect(await data.record()).toMatchObject({ setup: 'complete', mode: 'sample' })
  }, 40_000)
  it('verifies a Sample-first Live-capable runtime without connecting MSX or asking for page pairing', async () => {
    const data = await fixture('sample-in-live-runtime')
    const result = await data.run()
    expect((await data.calls()).some((call) => call.phase === 'owner')).toBe(false)
    expect(await data.record()).toMatchObject({ setup: 'complete', mode: 'live', initialDataMode: 'sample' })
    expect(result.stdout).toContain('not-required')
    expect(result.stdout).not.toContain('Type CONNECT')
  }, 40_000)
  it('retains a verified existing page without reinstalling, reconnecting or opening another tab', async () => {
    const data = await fixture('already-ready')
    const result = await data.run()
    expect((await data.calls()).some((call) => ['install', 'open', 'prompt'].includes(String(call.phase)))).toBe(false)
    expect(result.stdout).toContain('already connected')
    expect(await data.record()).toMatchObject({ setup: 'complete', installation: 'verified' })
  }, 40_000)
  it('resumes a previously hidden paired Teams page without reconnecting or approving a consumed code again', async () => {
    const data = await fixture('resume-hidden')
    const result = await data.run()
    const calls = await data.calls()
    expect(calls.some((call) => ['Connect', 'Approve'].includes(String(call.action)))).toBe(false)
    expect(calls.some((call) => call.phase === 'open')).toBe(true)
    expect(result.stdout).toContain('No new pairing approval was sent')
    expect(await data.record()).toMatchObject({ setup: 'complete', pairingCode: 'A1B2C3D4' })
  }, 40_000)
  it('does not mistake a connected account without the MSX resource for a verified source connection', async () => {
    const data = await fixture('account-only')
    await data.run()
    expect((await data.calls()).filter((call) => call.action === 'Connect')).toHaveLength(1)
    expect(await data.record()).toMatchObject({ setup: 'complete' })
  }, 40_000)
  it.each(['approval-only', 'browser-only', 'other-page', 'stale-heartbeat'])('does not treat %s as a verified Teams connection', async (scenario) => {
    const data = await fixture(scenario)
    await expect(data.run()).rejects.toMatchObject({ stderr: expect.stringContaining('no matching Teams client acknowledged') })
    expect(await data.record()).toMatchObject({ setup: 'waiting-for-client', installation: 'command-succeeded' })
  }, 40_000)
  it.each([
    ['wrong-backend', 'not this exact backend'],
    ['tampered-package', 'missing, changed or outside this run'],
    ['foreign-pid', 'reused PID or an unrelated'],
    ['stopped', 'backend is not running']
  ])('rejects %s before changing Teams or connecting a source', async (scenario, message) => {
    const data = await fixture(scenario)
    await expect(data.run()).rejects.toMatchObject({ stderr: expect.stringContaining(message) })
    let calls: Record<string, unknown>[] = []
    try { calls = await data.calls() } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    expect(calls.some((call) => ['install', 'open', 'owner'].includes(String(call.phase)))).toBe(false)
  }, 40_000)
  it('does not choose or auto-approve another pending page when the entered code is wrong', async () => {
    const data = await fixture('live', 'DEADBEEF')
    await expect(data.run()).rejects.toMatchObject({ stderr: expect.stringContaining('wrong page code') })
    expect((await data.calls()).filter((call) => call.action === 'Approve')).toMatchObject([{ code: 'DEADBEEF' }])
    expect((await data.record()).setup).not.toBe('complete')
  }, 40_000)
  it('does not connect a source if explicit consent is declined', async () => {
    const data = await fixture('decline-connect')
    await expect(data.run()).rejects.toMatchObject({ stderr: expect.stringContaining('paused before source connection') })
    expect((await data.calls()).some((call) => ['Connect', 'Approve'].includes(String(call.action)))).toBe(false)
  }, 40_000)
  it('guides a blocked CLI installation through exact-ZIP manual upload and still requires the client acknowledgement', async () => {
    const data = await fixture('manual-install')
    await data.run()
    expect((await data.calls()).some((call) => call.phase === 'prompt' && String(call.text).includes('INSTALLED'))).toBe(true)
    expect(await data.record()).toMatchObject({ installation: 'verified', setup: 'complete' })
  }, 40_000)
  it('persists a failed installation as incomplete and provides resume, not a successful launch', async () => {
    const data = await fixture('install-failure')
    await expect(data.run()).rejects.toMatchObject({ stderr: expect.stringContaining('Teams installation is incomplete') })
    expect(await data.record()).toMatchObject({ installation: 'failed', setup: 'backend-ready' })
    expect((await data.calls()).some((call) => call.phase === 'open')).toBe(false)
  }, 40_000)
  it('supports an explicit unattended upload without claiming client verification or initiating source access', async () => {
    const data = await fixture('no-guide')
    const result = await data.run()
    expect((await data.calls()).some((call) => ['open', 'owner', 'prompt'].includes(String(call.phase)))).toBe(false)
    expect(result.stdout).toContain('NOT verified')
    expect(await data.record()).toMatchObject({ installation: 'command-succeeded', setup: 'backend-ready' })
  }, 40_000)
})
