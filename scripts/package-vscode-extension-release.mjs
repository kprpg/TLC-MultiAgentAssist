import { createWriteStream } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionRoot = join(repositoryRoot, 'apps', 'vscode-extension')

/**
 * The extension host bundle imports the gitignored config/foundry.environment.json at
 * build time. Release builds (CI or a clean checkout) seed it from the checked-in
 * non-secret default, matching how packaged desktop releases behave. An existing
 * developer file is never overwritten.
 */
export async function seedFoundryEnvironment(sourceRoot = repositoryRoot) {
  const target = join(sourceRoot, 'config', 'foundry.environment.json')
  if (await pathExists(target)) return false
  await cp(join(sourceRoot, 'config', 'foundry.environment.default.json'), target)
  return true
}

/**
 * Projects the internal MCP server registry (config/mcp.servers.json) down to the client
 * configuration a VS Code or Copilot user needs to reach the same enabled remote servers.
 * Only enabled servers that expose an HTTP endpoint are emitted.
 */
export function buildClientMcpServers(registry) {
  const servers = {}
  for (const server of registry.servers ?? []) {
    if (!server.enabled || !server.serverUrl) continue
    servers[server.id] = { type: 'http', url: server.serverUrl }
  }
  return servers
}

export async function packageVsCodeExtensionRelease(
  outputRoot = join(repositoryRoot, 'release-ext'),
  sourceRoot = repositoryRoot
) {
  const extensionPackage = JSON.parse(
    await readFile(join(sourceRoot, 'apps', 'vscode-extension', 'package.json'), 'utf8')
  )
  const version = extensionPackage.version
  const vsixSource = join(sourceRoot, 'apps', 'vscode-extension', 'dist', 'tlc-assist-vscode.vsix')
  if (!(await pathExists(vsixSource))) {
    throw new Error(
      `VSIX not found at ${vsixSource}. Run "npm run ext:build" and "npm run ext:package" first.`
    )
  }

  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })

  const vsixTarget = join(outputRoot, `tlc-assist-vscode-${version}.vsix`)
  await cp(vsixSource, vsixTarget)

  const configZip = join(outputRoot, `tlc-assist-vscode-mcp-config-${version}.zip`)
  await stageAndZipMcpConfig({ outputZip: configZip, version, sourceRoot })

  return { outputRoot, version, vsix: vsixTarget, mcpConfig: configZip }
}

async function stageAndZipMcpConfig({ outputZip, version, sourceRoot }) {
  const staging = await mkdtemp(join(tmpdir(), 'tlc-ext-mcp-'))
  try {
    const registry = JSON.parse(
      await readFile(join(sourceRoot, 'config', 'mcp.servers.json'), 'utf8')
    )
    const servers = buildClientMcpServers(registry)

    await cp(
      join(sourceRoot, 'config', 'mcp.servers.json'),
      join(staging, 'config', 'mcp.servers.json')
    )
    await cp(
      join(sourceRoot, 'config', 'mcp.tool-policy.json'),
      join(staging, 'config', 'mcp.tool-policy.json')
    )
    await cp(
      join(sourceRoot, 'config', 'dataverse.entity-map.json'),
      join(staging, 'config', 'dataverse.entity-map.json')
    )
    await cp(
      join(sourceRoot, 'config', 'foundry.environment.example.json'),
      join(staging, 'config', 'foundry.environment.example.json')
    )

    const vsCodeConfig = { servers }
    const portableConfig = { mcpServers: servers }
    await writeJson(join(staging, '.vscode', 'mcp.json'), vsCodeConfig)
    await writeJson(join(staging, '.mcp.json'), portableConfig)
    await writeFile(join(staging, 'INSTALL.md'), buildInstallGuide({ version, servers }))

    await mkdir(dirname(outputZip), { recursive: true })
    await rm(outputZip, { force: true })
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const completion = pipeline(archive, createWriteStream(outputZip))
    archive.directory(staging, false)
    await archive.finalize()
    await completion
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

function buildInstallGuide({ version, servers }) {
  const serverIds = Object.keys(servers)
  const primary = serverIds[0] ?? 'dataverse'
  const primaryUrl = servers[primary]?.url ?? 'https://microsoftsales.crm.dynamics.com/api/mcp'
  return `# TLC Assist VS Code extension - install and MCP configuration

Version: ${version}

This bundle accompanies the \`tlc-assist-vscode-${version}.vsix\` extension package from the
GitHub Releases page. The \`.vsix\` is self-contained and already embeds the MCP server
registry and default-deny tool policy, so sample mode works with no extra setup. The files
here are provided for transparency and for connecting VS Code's native MCP client (for
example Copilot Chat agent mode) to the same Dataverse endpoint the extension uses.

## What you actually need

Installing the extension requires only **VS Code (or VS Code Insiders) 1.90.0 or later** and
the \`.vsix\`. The MCP configuration in this bundle is **optional** - the extension ships
with it embedded. Nothing else is required to run in **sample** mode.

| To... | You need |
| --- | --- |
| Install the extension | VS Code / VS Code Insiders 1.90.0+ and the \`.vsix\`. No Node.js, npm, or native binaries. |
| Run in **sample** mode | Nothing else. No sign-in, no network, no Azure CLI. |
| Run in **live** mode | A corporate Microsoft identity (VS Code's built-in Microsoft sign-in) with MSX/Dataverse access, plus network access to \`microsoftsales.crm.dynamics.com\`. |
| Use the real Microsoft Foundry agents (\`tlc.useFoundryAgents\`, on by default in live mode) | Azure CLI installed and \`az login\` completed, plus access to the configured Foundry project. Set \`tlc.useFoundryAgents\` to \`false\` to use the built-in deterministic guidance instead. |
| Native VS Code MCP client (optional) | The \`.vscode/mcp.json\` or \`.mcp.json\` from this bundle (see section 2). |

Notes:

- A VSIX installed from file is **not auto-updated**. To upgrade, download the newer
  \`.vsix\` from the Releases page and install it again.
- VS Code 1.97 and later shows a one-time **publisher trust** dialog the first time you
  install this extension. Confirm it to continue.

## 1. Install the extension

1. Download \`tlc-assist-vscode-${version}.vsix\` from the release assets.
2. In VS Code, open the Command Palette (Ctrl+Shift+P) and run
   **Extensions: Install from VSIX...**, then select the downloaded file.
   Or from a terminal:
   \`\`\`
   code --install-extension tlc-assist-vscode-${version}.vsix --force
   \`\`\`
3. Run **Developer: Reload Window**.
4. Select the **TLC Assist** icon in the Activity Bar, or run **TLC: Open Assist**.

The extension starts in **sample** mode (sanitized fixtures, no network calls). Switch to
live data by setting \`tlc.mode\` to \`live\` in Settings, which requires a delegated
Microsoft identity and an authenticated Azure CLI session (\`az login\`).

## 2. (Optional) Add the Dataverse MCP server to VS Code

The extension talks to Dataverse through its own bundled MCP client, so you do **not** need
this step to use TLC Assist. Use it only if you also want VS Code's native MCP client
(Copilot Chat agent mode) to reach the same endpoint.

- **Workspace (VS Code format):** copy \`.vscode/mcp.json\` into your workspace's
  \`.vscode\` folder.
- **Workspace (portable format):** copy \`.mcp.json\` to the root of your workspace. This
  format also works with the Copilot CLI and Agent Host.

Both files point VS Code at the \`${primary}\` server:

\`\`\`json
{
  "servers": {
    "${primary}": {
      "type": "http",
      "url": "${primaryUrl}"
    }
  }
}
\`\`\`

VS Code performs the Microsoft Entra sign-in for the HTTP server on first use. No API key or
secret is stored in these files. Only trust and start MCP servers you recognize.

## 3. Reference configuration (\`config/\`)

| File | Purpose |
| --- | --- |
| \`config/mcp.servers.json\` | Full MCP server registry (endpoints, limits, retry, circuit breaker) the extension embeds. |
| \`config/mcp.tool-policy.json\` | Default-deny tool policy: which tools are allowed, approval mode, rate limits, and redaction. |
| \`config/dataverse.entity-map.json\` | Canonical-to-Dataverse entity/attribute map, including per-user scope predicates. |
| \`config/foundry.environment.example.json\` | Template for a custom Microsoft Foundry project and agent bindings. Never add secrets. |

These mirror the files the extension was built with. Editing them here does not change the
installed \`.vsix\`; they document the shipped behavior and seed your own deployments.
`
}

async function writeJson(target, value) {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`)
}

async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function runNpmScript(script) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['run', script], {
      cwd: repositoryRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`npm run ${script} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
    })
  })
}

async function buildPackageAndStage() {
  const seeded = await seedFoundryEnvironment()
  if (seeded) {
    console.info('Seeded config/foundry.environment.json from the checked-in default.')
  }
  await runNpmScript('ext:build')
  await runNpmScript('ext:package')
  const result = await packageVsCodeExtensionRelease()
  console.info(`VS Code extension release artifacts published in ${result.outputRoot}:`)
  console.info(`  - ${result.vsix}`)
  console.info(`  - ${result.mcpConfig}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPackageAndStage()
}
