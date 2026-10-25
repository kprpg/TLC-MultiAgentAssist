import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function verifyWebAccess(baseUrl, { protectedAccess = false, fetchFn = fetch } = {}) {
  const response = await fetchFn(new URL('/', baseUrl), {
    redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(20_000)
  })
  if (protectedAccess ? ![302, 303, 307, 308, 401, 403].includes(response.status) : response.status !== 200) {
    throw new Error(`The restored anonymous-access policy was not verified: HTTP ${response.status}`)
  }
}

export async function verifyAnonymousSample(baseUrl, { sqlite = true, fetchFn = fetch } = {}) {
  async function request(path, init = {}) {
    const response = await fetchFn(new URL(path, baseUrl), {
      ...init, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(20_000)
    })
    if (response.status !== 200) throw new Error(`Anonymous sample check failed at ${path}: HTTP ${response.status}`)
    return response
  }

  const health = await (await request('/api/health')).json()
  if (health.status !== 'ready') throw new Error('Sample health endpoint is not ready.')
  const html = await (await request('/')).text()
  if (!html.includes('<div id="root">') || !html.includes('<meta name="tlc-data-mode" content="sample" />')
      || !html.includes('<meta name="tlc-local-exit" content="0" />')) {
    throw new Error('The hosted page is not the sample application with local shutdown disabled.')
  }
  const identity = await (await request('/api/me')).json()
  if (identity.email !== 'sample.user@example.com') throw new Error('The API is not using the sample identity.')
  const accounts = await (await request('/api/accounts?includeHidden=true')).json()
  if (!Array.isArray(accounts) || !accounts.some((account) => account?.id === 'account-contoso')) {
    throw new Error('The anonymous API did not return the seeded sample accounts.')
  }
  const opportunities = await (await request('/api/accounts/account-contoso/opportunities')).json()
  const contoso = accounts.find((account) => account?.id === 'account-contoso')
  if (!Array.isArray(opportunities) || (contoso.visibility !== 'hidden'
      && !opportunities.some((opportunity) => opportunity?.id === 'opp-grid-modernization'))) {
    throw new Error('The anonymous API did not return the seeded sample opportunities.')
  }
  if (sqlite) {
    const transcripts = await (await request('/api/meeting-transcripts')).json()
    if (!Array.isArray(transcripts) || typeof transcripts[0]?.id !== 'string') {
      throw new Error('The SQLite sample meeting transcripts are unavailable.')
    }
    const transcript = await (await request(`/api/meeting-transcripts/${encodeURIComponent(transcripts[0].id)}`)).json()
    if (transcript?.id !== transcripts[0].id) throw new Error('The SQLite sample transcript could not be retrieved.')
  }
}

export async function smokeWebRelease(packageRoot = resolve('release-web/package'), {
  sqlite = process.env.TLC_DATA_STORE === 'sqlite', entryPoint = 'server.js', onReady
} = {}) {
const port = await findAvailablePort()
const child = spawn(process.execPath, [entryPoint], {
  cwd: packageRoot,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    TLC_WEB_MODE: 'sample',
    TLC_DATA_MODE: 'sample',
    TLC_DATA_STORE: sqlite ? 'sqlite' : 'fixture',
    TLC_DATA_STORE_PATH: ':memory:',
    TLC_HOSTING_MODEL: 'single-instance',
    TLC_BACKGROUND_SYNC: '0',
    TLC_WEB_STATIC_ROOT: resolve(packageRoot, 'apps/desktop/dist/revamp'),
    WEBSITE_SITE_NAME: 'tlc-web-release-smoke'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk })
child.stderr.on('data', (chunk) => { output += chunk })

try {
  const baseUrl = `http://127.0.0.1:${port}`
  const startup = new AbortController()
  try {
    await Promise.race([
      fetchWithRetry(`${baseUrl}/api/health`, { signal: startup.signal }),
      new Promise((_, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => reject(new Error(`Web release exited before readiness: ${code}`)))
      })
    ])
  } finally { startup.abort() }
  await verifyAnonymousSample(baseUrl, { sqlite })
  const exit = await fetch(`${baseUrl}/api/exit`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
  if (exit.status !== 404) throw new Error(`Hosted sample exposed local application exit: HTTP ${exit.status}`)
  await onReady?.(baseUrl)
  await verifyAnonymousSample(baseUrl, { sqlite })
  console.info('Web release smoke test passed.')
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, { cause: error })
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
    let timer
    child.kill()
    await Promise.race([exited, new Promise((resolveTimeout) => { timer = setTimeout(resolveTimeout, 5_000) })])
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  }
}
}

export async function fetchWithRetry(url, { attempts = 120, delayMs = 500, fetchFn = fetch, signal } = {}) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    signal?.throwIfAborted()
    try {
      return await fetchFn(url, { signal })
    } catch (error) {
      signal?.throwIfAborted()
      lastError = error
      if (attempt < attempts - 1) await delay(delayMs, undefined, { signal })
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--url' || process.argv[2] === '--access-url') {
    const remote = URL.parse(process.argv[3] || '')
    if (!remote || remote.protocol !== 'https:' || remote.username || remote.password || remote.search || remote.hash || remote.pathname !== '/') {
      throw new Error('Remote sample verification requires a root HTTPS URL without credentials, query or fragment.')
    }
    if (process.argv[2] === '--url') {
      await verifyAnonymousSample(process.argv[3])
      console.info('Anonymous SQLite sample verification passed.')
    } else {
      if (!['--protected', '--public'].includes(process.argv[4])) throw new Error('Access verification requires --protected or --public.')
      await verifyWebAccess(process.argv[3], { protectedAccess: process.argv[4] === '--protected' })
      console.info('Restored anonymous-access policy verified; authenticated live functionality requires its normal sign-in.')
    }
  } else {
    await smokeWebRelease(resolve(process.argv[2] || 'release-web/package'))
  }
}