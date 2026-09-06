import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const packageRoot = resolve(process.argv[2] || 'release-web/package')
const port = await findAvailablePort()
const child = spawn(process.execPath, ['server.js'], {
  cwd: packageRoot,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    TLC_WEB_MODE: 'sample'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk })
child.stderr.on('data', (chunk) => { output += chunk })

try {
  const health = await fetchWithRetry(`http://127.0.0.1:${port}/api/health`)
  if (!health.ok || (await health.json()).status !== 'ready') {
    throw new Error(`Unexpected health response: ${health.status}`)
  }

  const page = await fetch(`http://127.0.0.1:${port}/`)
  const html = await page.text()
  if (!page.ok || !html.includes('<div id="root">')) {
    throw new Error(`Unexpected application response: ${page.status}`)
  }
  console.info('Web release smoke test passed.')
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, { cause: error })
} finally {
  child.kill()
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function fetchWithRetry(url) {
  let lastError
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(url)
    } catch (error) {
      lastError = error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
    }
  }
  throw lastError
}

async function findAvailablePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  await new Promise((resolveClose) => server.close(resolveClose))
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a test port.')
  return address.port
}