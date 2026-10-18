import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ZipArchive } from 'archiver'
import JSZip from 'jszip'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = 'TLC_TEAMS_GENERATED_RUNTIME'

export async function stageTeamsRuntime(outputDirectory = join(root, 'release-teams', 'runtime'), sourceRoot = root) {
  const target = resolve(outputDirectory)
  if (basename(target) !== 'runtime' || target === resolve(sourceRoot)) throw new Error('A dedicated runtime output directory is required.')
  let exists = true
  try { await readdir(target) } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false }
  if (exists) {
    if ((await readFile(join(target, '.generated-teams-runtime'), 'utf8')) !== marker) throw new Error('Refusing to replace a directory not owned by the Teams packager.')
    await rm(target, { recursive: true, force: true })
  }
  await mkdir(target, { recursive: true })
  await writeFile(join(target, '.generated-teams-runtime'), marker)
  const rootPackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  const teamsPackage = JSON.parse(await readFile(join(sourceRoot, 'apps', 'teams', 'package.json'), 'utf8'))
  const mcpPackage = JSON.parse(await readFile(join(sourceRoot, 'packages', 'connectors', 'mcp', 'package.json'), 'utf8'))
  const documentsPackage = JSON.parse(await readFile(join(sourceRoot, 'packages', 'documents', 'package.json'), 'utf8'))
  const dependencies = {}
  for (const name of ['@azure/ai-projects', '@azure/identity', 'pdf-parse', 'zod']) {
    if (!rootPackage.dependencies[name]) throw new Error(`Missing declared runtime dependency: ${name}`)
    dependencies[name] = rootPackage.dependencies[name]
  }
  for (const name of ['@azure/data-tables', '@azure/msal-node', '@microsoft/teams.apps', 'express', 'jose']) {
    if (teamsPackage.dependencies[name]) dependencies[name] = teamsPackage.dependencies[name]
  }
  dependencies['@modelcontextprotocol/sdk'] = mcpPackage.dependencies['@modelcontextprotocol/sdk']
  Object.assign(dependencies, documentsPackage.dependencies)
  const build = join(sourceRoot, 'apps', 'teams', 'dist')
  await cp(join(build, 'server.js'), join(target, 'server.js'))
  if ((await readdir(build)).includes('server.js.map')) await cp(join(build, 'server.js.map'), join(target, 'server.js.map'))
  await cp(join(build, 'client'), join(target, 'client'), { recursive: true })
  for (const name of ['foundry.environment.example.json', 'mcp.servers.json', 'mcp.tool-policy.json', 'dataverse.entity-map.json', 'teams-disclosure.example.json']) {
    await mkdir(join(target, 'config'), { recursive: true })
    await cp(join(sourceRoot, 'config', name), join(target, 'config', name))
  }
  await cp(join(sourceRoot, 'apps', 'teams', '.env.example'), join(target, 'runtime.env.example'))
  await mkdir(join(target, 'docs', 'knowledge'), { recursive: true })
  await cp(join(sourceRoot, 'docs', 'knowledge', 'MCEM Overview.pdf'), join(target, 'docs', 'knowledge', 'MCEM Overview.pdf'))
  await writeFile(join(target, 'package.json'), `${JSON.stringify({
    name: '@tlc/teams-release', version: teamsPackage.version, private: true, type: 'module',
    engines: rootPackage.engines, scripts: {
      start: 'node --experimental-sqlite server.js',
      'start:configured': 'node --env-file=runtime.env --experimental-sqlite server.js'
    }, dependencies
  }, null, 2)}\n`)
  await writeFile(join(target, 'RUNTIME-README.txt'), [
    'TLC Assist Teams host runtime',
    '',
    'Run this ordinary web application yourself: local dev/test now, Azure later.',
    'This runtime ZIP is not the manifest/icons ZIP to upload into Teams.',
    'Uploading the Teams ZIP neither starts this server nor deploys Azure resources.',
    'The bundled node_modules match the packaging OS and CPU. Restore dependencies',
    'with npm ci --omit=dev on the destination platform when they differ.',
    'Start a sanitized preview: npm start. Stop the foreground process with Ctrl+C.',
    'For explicit configuration, copy runtime.env.example to runtime.env, then use:',
    'npm run start:configured',
    'Node environment variables take precedence over runtime.env; check mode/profile.',
    'The default loopback listener does not open a firewall, LAN port or tunnel.',
    'local profile: SQLite state, encrypted in live mode; no required Azure Table.',
    'Live local Foundry access uses AzureCliCredential in the configured Foundry tenant.',
    'Azure CLI is for Foundry workload access only, NEVER a substitute for an FTE',
    "colleague's delegated MSX/Dataverse/Graph permissions. Live app sign-in remains.",
    'azure profile: managed identity for workload access and configured Table Storage.',
    'Live mode still requires approved Entra/consent/FTE/MSX/MCP/Graph/Foundry setup.',
    'runtime.env.example and config/teams-disclosure.example.json are safe templates,',
    'not working live credentials or an approved disclosure policy. They are not auto-loaded.',
    'Set TLC_TEAMS_ADMISSION=read-only to stop new work while retaining authorized reads.',
    'No credentials or real Foundry environment configuration are bundled.',
    '',
    'State and recovery:',
    'Default local state is under LOCALAPPDATA\\TLC-Assist\\Teams\\<mode>, outside this',
    'release folder. Live state additionally separates the tenant and environment.',
    'TLC_TEAMS_DATA_DIR can select an approved local directory. Keep its filesystem',
    'ACLs limited to the operator and use approved disk encryption; row metadata is',
    'not hidden by payload encryption. A live 32-byte TLC_TEAMS_STATE_KEY is required.',
    'Keep the state key stable and back it up separately in an approved secret store.',
    'Do not put secrets, live state or transcript data in a distribution ZIP.',
    'For a backup: stop this runtime, copy its entire data directory to an approved',
    'protected backup, and retain the matching configuration/key separately.',
    'For an update: stop, backup, extract to a new release directory, retain the same',
    'external data directory/key, verify privately, then restart. Never overwrite state.',
    'Restart does not replay claimed writes; reconcile unknown outcomes. In-memory',
    'workflows and delegated sessions do not transparently resume; users sign in again.',
    'Restore first with admission read-only, reconcile receipts/external effects,',
    'then explicitly resume. Restoring old state cannot undo external source writes.',
    '',
    'Connectivity and logs:',
    'Tabs need HTTPS reachable from their clients; bot/message-extension/Graph',
    'callbacks need Microsoft-service reachability. Private localhost is insufficient.',
    'An approved tunnel/HTTPS ingress is opt-in and is NOT launched by these commands.',
    'Sleep, shutdown, network changes or a stopped tunnel make the app unavailable.',
    'Keep origin, Entra redirect/broker configuration, bot endpoint, callback URL and',
    'manifest URLs/validDomains consistent; regenerate/reinstall for origin changes.',
    'Console diagnostics contain safe codes/category/correlation IDs, not prompts,',
    'customer payloads, transcripts or tokens. Protect/rotate any redirected log files.',
    'No Windows Service or automatic background installation is required.',
    ''
  ].join('\n'))
  return target
}

export function createRuntimeInstallEnvironment(environment = process.env) {
  const childEnvironment = { ...environment }
  // npm run exports .npmrc policy as flags; npm rejects those for a child project.
  for (const key of Object.keys(childEnvironment)) {
    if (key.toLowerCase() === 'npm_config_allow_scripts') delete childEnvironment[key]
  }
  return childEnvironment
}

export function installTeamsRuntime(runtime, environment = process.env) {
  const install = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: runtime, shell: process.platform === 'win32', stdio: 'inherit',
    env: createRuntimeInstallEnvironment(environment)
  })
  if (install.error) throw install.error
  if (install.status !== 0) throw new Error('Runtime production dependency installation failed.')
}

export async function packageTeamsRuntime() {
  const runtime = await stageTeamsRuntime()
  installTeamsRuntime(runtime)
  const output = join(root, 'release-teams', `TLC-Assist-Teams-runtime-${process.platform}-${process.arch}.zip`)
  await new Promise((resolveZip, reject) => {
    const destination = createWriteStream(output)
    const archive = new ZipArchive({ forceZip64: true, zlib: { level: 1 } })
    destination.on('close', resolveZip)
    destination.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', reject)
    archive.pipe(destination)
    archive.directory(runtime, false)
    void archive.finalize().catch(reject)
  })
  const zip = await JSZip.loadAsync(await readFile(output), { checkCRC32: true })
  for (const name of ['server.js', 'client/index.html', 'package.json', 'package-lock.json', 'node_modules/express/package.json', 'config/mcp.tool-policy.json']) {
    if (!zip.file(name)) throw new Error(`Runtime archive is incomplete: ${name}`)
  }
  if (Object.keys(zip.files).some((name) => /(^|\/)(\.env($|\.)|runtime\.env$)|foundry\.environment\.json$|portfolio-preferences|\.sqlite($|-)/i.test(name))) {
    throw new Error('Private environment or state files were included in the runtime archive.')
  }
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.info(`Teams runtime ZIP: ${await packageTeamsRuntime()}`)
}
