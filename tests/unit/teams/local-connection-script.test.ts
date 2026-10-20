import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const script = resolve(import.meta.dirname, '../../../scripts/teams-local-connection.ps1')
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function fixture(scenario = 'matching') {
  const folder = await mkdtemp(join(tmpdir(), 'tlc-owner-script-'))
  folders.push(folder)
  const work = join(folder, 'work')
  const runId = '1'.repeat(32)
  const runtime = join(work, 'releases', runId)
  const owner = join(work, 'private')
  await mkdir(runtime, { recursive: true })
  await mkdir(owner)
  await writeFile(join(runtime, '.runner-owner'), runId)
  await writeFile(join(runtime, 'server.js'), `
const fs = require('node:fs');
fs.writeFileSync(process.env.TLC_OWNER_SCRIPT_TRACE, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ contractVersion: '1.0', ok: true, pending: [],
  status: { contractVersion: '1.0', state: 'connected', detail: 'Offline fixture', resources: [], capabilities: [] } }));
`)
  await writeFile(join(work, 'current-run.json'), JSON.stringify({
    runId, runtimeDirectory: runtime, ownerDirectory: owner, pid: 2147483000,
    startTimeUtc: '2026-10-19T20:00:00.0000000Z', origin: 'https://localhost:49199', authentication: 'local-azure-cli'
  }))
  await writeFile(join(owner, 'control.json'), JSON.stringify({
    contractVersion: '1.0', instanceId: '22222222-2222-4222-8222-222222222222',
    processId: scenario === 'wrong-pid' ? 2147483001 : 2147483000,
    origin: scenario === 'wrong-origin' ? 'https://localhost:49200' : 'https://localhost:49199'
  }))
  const wrapper = join(folder, 'invoke.ps1')
  await writeFile(wrapper, `
$ErrorActionPreference = 'Stop'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
Set-Acl -LiteralPath $env:TLC_OWNER_SCRIPT_WORK -AclObject $acl
function Get-Process {
  param($Id)
  $start = ([DateTimeOffset]'2026-10-19T20:00:00Z').UtcDateTime
  if ($env:TLC_OWNER_SCRIPT_SCENARIO -eq 'reused-pid') { $start = $start.AddHours(1) }
  return [pscustomobject]@{ Id=$Id; StartTime=$start }
}
function Get-CimInstance {
  param($ClassName, $Filter)
  return [pscustomobject]@{ CommandLine='node "' + (Join-Path $env:TLC_OWNER_SCRIPT_RUNTIME 'server.js') + '"' }
}
$value = & $env:TLC_OWNER_SCRIPT -Action $env:TLC_OWNER_SCRIPT_ACTION -WorkDirectory $env:TLC_OWNER_SCRIPT_WORK -UserCode A1B2C3D4 -PassThru
if ($value -is [string]) { throw 'PassThru must return a structured result, not console text.' }
$value | ConvertTo-Json -Depth 8
`)
  const trace = join(folder, 'trace.json')
  const run = (action = 'Status') => execute('pwsh', ['-NoProfile', '-File', wrapper], {
    env: {
      ...process.env, TLC_OWNER_SCRIPT: script, TLC_OWNER_SCRIPT_SCENARIO: scenario, TLC_OWNER_SCRIPT_WORK: work,
      TLC_OWNER_SCRIPT_RUNTIME: runtime, TLC_OWNER_SCRIPT_TRACE: trace, TLC_OWNER_SCRIPT_ACTION: action
    }, timeout: 30_000
  })
  return { run, trace, owner }
}

describe.skipIf(process.platform !== 'win32')('launcher-to-owner backend identity binding', () => {
  it.each(['Status', 'Connect', 'Approve'])('dispatches %s only through the matching owned process/origin and returns structured output', async (action) => {
    const data = await fixture()
    const result = await data.run(action)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: { state: 'connected' } })
    const arguments_ = JSON.parse(await readFile(data.trace, 'utf8'))
    expect(arguments_.slice(0, 3)).toEqual(['--local-owner', action.toLowerCase(), data.owner])
    if (action === 'Approve') expect(arguments_[3]).toBe('A1B2C3D4')
  }, 40_000)
  it.each(['wrong-pid', 'wrong-origin', 'reused-pid'])('rejects %s before executing any owner/source command', async (scenario) => {
    const data = await fixture(scenario)
    await expect(data.run('Connect')).rejects.toMatchObject({ stderr: expect.stringMatching(/does not match|reused PID/) })
    await expect(readFile(data.trace)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 40_000)
})
