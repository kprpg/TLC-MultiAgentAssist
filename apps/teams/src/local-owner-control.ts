import { execFile } from 'node:child_process'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  localConnectionVersion, localOwnerCommandSchema, localOwnerRecordSchema, localOwnerResultSchema,
  type LocalOwnerCommand, type LocalOwnerRecord, type LocalOwnerResult
} from '../../../packages/common/contracts/local-connection.js'
import { canonicalJson } from '../../../packages/orchestrator/collaboration/reviewed-actions.js'

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const helloSchema = z.object({ instanceId: z.uuid(), nonce: nonceSchema }).strict()
const requestSchema = z.object({ nonce: nonceSchema, command: localOwnerCommandSchema, mac: nonceSchema }).strict()
const responseSchema = z.object({ nonce: nonceSchema, result: localOwnerResultSchema, mac: nonceSchema }).strict()
const pipeName = (instanceId: string) => process.platform === 'win32' ? `\\\\.\\pipe\\tlc-teams-owner-${instanceId}` : join(tmpdir(), `tlc-owner-${instanceId}.sock`)
function mac(key: Buffer, kind: string, instanceId: string, nonce: string, value: unknown): string {
  return createHmac('sha256', key).update(canonicalJson({ version: localConnectionVersion, kind, instanceId, nonce, value })).digest('base64url')
}
const equal = (first: string, second: string) => first.length === second.length && timingSafeEqual(Buffer.from(first), Buffer.from(second))
const rejected = () => new Error('The protected local owner command was rejected or the owner runtime is unavailable.')

export async function startOwnerControlTransport(options: {
  key: Buffer; instanceId: string
  execute(command: LocalOwnerCommand): Promise<LocalOwnerResult>
  onError?(code: string): void
}) {
  if (options.key.length !== 32) throw rejected()
  z.uuid().parse(options.instanceId)
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    if (sockets.size >= 8) { socket.destroy(); options.onError?.('owner_connection_capacity'); return }
    sockets.add(socket)
    socket.setEncoding('utf8')
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => options.onError?.('owner_transport_failed'))
    socket.setTimeout(10_000, () => socket.destroy())
    const nonce = randomBytes(32).toString('base64url')
    socket.write(JSON.stringify({ instanceId: options.instanceId, nonce }) + '\n')
    let buffer = ''
    let consumed = false
    socket.on('data', (chunk: string) => {
      if (consumed) { socket.destroy(); return }
      buffer += chunk
      if (buffer.length > 16_384) { consumed = true; socket.destroy(); options.onError?.('owner_request_too_large'); return }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      consumed = true
      void (async () => {
        try {
          if (buffer.slice(newline + 1)) throw rejected()
          const request = requestSchema.parse(JSON.parse(buffer.slice(0, newline)))
          if (request.nonce !== nonce || !equal(request.mac, mac(options.key, 'request', options.instanceId, nonce, request.command))) throw rejected()
          socket.setTimeout(300_000, () => socket.destroy())
          const result = localOwnerResultSchema.parse(await options.execute(request.command))
          if (!socket.destroyed) socket.end(JSON.stringify({ nonce, result, mac: mac(options.key, 'response', options.instanceId, nonce, result) }) + '\n')
        } catch {
          options.onError?.('owner_command_rejected')
          socket.destroy()
        }
      })()
    })
  })
  await new Promise<void>((ready, reject) => {
    server.once('error', reject)
    server.listen(pipeName(options.instanceId), () => { server.removeListener('error', reject); ready() })
  })
  return {
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((closed, reject) => server.close((error) => error ? reject(error) : closed()))
    }
  }
}

export async function sendOwnerCommand(options: { key: Buffer; record: LocalOwnerRecord; command: unknown }): Promise<LocalOwnerResult> {
  const command = localOwnerCommandSchema.parse(options.command)
  const record = localOwnerRecordSchema.parse(options.record)
  return new Promise<LocalOwnerResult>((done, fail) => {
    const socket = createConnection(pipeName(record.instanceId))
    socket.setEncoding('utf8')
    let settled = false
    const reject = () => { if (!settled) { settled = true; socket.destroy(); fail(rejected()) } }
    socket.on('error', reject); socket.on('end', () => { if (!settled) reject() })
    socket.setTimeout(300_000, reject)
    let buffer = ''
    let nonce: string | undefined
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > 16_384) { reject(); return }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const value: unknown = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (buffer) throw rejected()
        if (!nonce) {
          const hello = helloSchema.parse(value)
          if (hello.instanceId !== record.instanceId) throw rejected()
          nonce = hello.nonce
          socket.write(JSON.stringify({ nonce, command, mac: mac(options.key, 'request', record.instanceId, nonce, command) }) + '\n')
        } else {
          const response = responseSchema.parse(value)
          if (response.nonce !== nonce || !equal(response.mac, mac(options.key, 'response', record.instanceId, nonce, response.result))) throw rejected()
          settled = true; socket.end(); done(response.result)
        }
      } catch { reject() }
    })
  })
}

const directoryPolicy = String.raw`
$ErrorActionPreference = 'Stop'
$path = [IO.Path]::GetFullPath($env:TLC_OWNER_DIRECTORY)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$base = [IO.Path]::GetFullPath([Environment]::GetFolderPath('LocalApplicationData'))
$prefix = $base.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (!$path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'owner_directory_must_be_per_user_local_appdata' }
if (!(Test-Path -LiteralPath $path)) {
  if ($env:TLC_OWNER_PREPARE -ne '1') { throw 'owner_directory_missing' }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
  New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, $system)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
$directory = Get-Item -LiteralPath $path -Force
if (!$directory.PSIsContainer) { throw 'owner_directory_invalid' }
$ancestor = $directory
$trustedParents = @($sid.Value, $system.Value, 'S-1-5-32-544', 'S-1-3-0')
$write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
while ($null -ne $ancestor) {
  if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner_reparse_point_denied' }
  if ($ancestor.FullName -eq $base -or $ancestor.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    $parentAcl = Get-Acl -LiteralPath $ancestor.FullName
    if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trustedParents) { throw 'owner_parent_not_trusted' }
    foreach ($rule in $parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trustedParents -and ($rule.FileSystemRights -band $write)) { throw 'owner_parent_writable_by_another_user' }
    }
  }
  $ancestor = $ancestor.Parent
}
$acl = Get-Acl -LiteralPath $path
if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner_directory_not_private' }
$allowed = @($sid.Value, $system.Value)
foreach ($item in @($directory) + @(Get-ChildItem -LiteralPath $path -Force -Recurse)) {
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'owner_reparse_point_denied' }
  $itemAcl = Get-Acl -LiteralPath $item.FullName
  if ($itemAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner_file_owner_mismatch' }
  foreach ($rule in $itemAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { throw 'owner_directory_not_private' }
  }
}
`
async function checkDirectory(directory: string, prepare: boolean): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Local native owner control requires Windows owner ACLs.')
  try {
    await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-Command', directoryPolicy], {
      env: { ...process.env, TLC_OWNER_DIRECTORY: resolve(directory), TLC_OWNER_PREPARE: prepare ? '1' : '0' }, timeout: 30_000
    })
  } catch { throw new Error('The native owner directory must be an owner/SYSTEM-only non-reparse directory. Prepare it with the local owner command.') }
}
export async function prepareOwnerDirectory(directory: string): Promise<void> {
  await checkDirectory(directory, true)
  const path = join(directory, 'state.key')
  try { await writeFile(path, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error }
  await readOwnerStateKey(directory)
}
export async function readOwnerStateKey(directory: string): Promise<string> {
  await checkDirectory(directory, false)
  const key = await readFile(join(directory, 'state.key'), 'utf8')
  if (Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) throw new Error('The protected native state key is invalid.')
  return key
}
export async function startProtectedOwnerControl(options: {
  directory: string; origin: string
  execute(command: LocalOwnerCommand): Promise<LocalOwnerResult>
  onError(code: string): void
}) {
  await checkDirectory(options.directory, false)
  const recordPath = join(options.directory, 'control.json')
  try {
    const previous = localOwnerRecordSchema.parse(JSON.parse(await readFile(recordPath, 'utf8')))
    try { process.kill(previous.processId, 0) }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH') throw error
      previous.processId = 0
    }
    if (previous.processId) throw new Error('The native owner directory is already assigned to a running process.')
  } catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error }
  const key = randomBytes(32)
  const record: LocalOwnerRecord = { contractVersion: localConnectionVersion, instanceId: randomUUID(), processId: process.pid, origin: options.origin }
  const transport = await startOwnerControlTransport({ key, instanceId: record.instanceId, execute: options.execute, onError: options.onError })
  const temporary = join(options.directory, `${record.instanceId}.json`)
  try {
    await writeFile(join(options.directory, 'control.key'), key.toString('base64'), { mode: 0o600 })
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    await rename(temporary, recordPath)
  } catch (error) { await transport.close(); throw error }
  return {
    async close(): Promise<void> {
      await transport.close()
      await unlink(recordPath)
      await unlink(join(options.directory, 'control.key'))
    }
  }
}
export async function invokeProtectedOwnerCommand(directory: string, command: unknown): Promise<LocalOwnerResult> {
  await checkDirectory(directory, false)
  const record = localOwnerRecordSchema.parse(JSON.parse(await readFile(join(directory, 'control.json'), 'utf8')))
  const keyPath = join(directory, 'control.key')
  if (!(await lstat(keyPath)).isFile()) throw rejected()
  const encoded = await readFile(keyPath, 'utf8')
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) throw rejected()
  return sendOwnerCommand({ key, record, command })
}
