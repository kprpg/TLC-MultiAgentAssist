import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildStaticHandler, setSecurityHeaders } from '../../../apps/web/src/hosting.js'

describe('hosted web static files', () => {
    let server: Server | undefined
    let staticRoot: string | undefined

    afterEach(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
        if (staticRoot) await rm(staticRoot, { recursive: true, force: true })
        server = undefined
        staticRoot = undefined
    })

    it('serves the SPA in live mode with restrictive browser headers', async () => {
        const baseUrl = await listen()

        const response = await fetch(`${baseUrl}/accounts/contoso`)
        const body = await response.text()

        expect(response.status).toBe(200)
        expect(body).toContain('<meta name="tlc-data-mode" content="live" />')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('serves fingerprinted assets with immutable caching', async () => {
        const baseUrl = await listen()

        const response = await fetch(`${baseUrl}/main.js`)

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    })

    it('leaves the live marker out in sample mode', async () => {
        const baseUrl = await listen('sample')

        const response = await fetch(baseUrl)
        const body = await response.text()

        expect(response.status).toBe(200)
        expect(body).not.toContain('name="tlc-data-mode"')
    })

    async function listen(dataMode: 'live' | 'sample' = 'live'): Promise<string> {
        staticRoot = await mkdtemp(join(tmpdir(), 'tlc-web-'))
        await Promise.all([
            writeFile(join(staticRoot, 'index.html'), '<html><head></head><body>TLC</body></html>'),
            writeFile(join(staticRoot, 'main.js'), 'console.log("TLC")')
        ])
        const serveStatic = buildStaticHandler(staticRoot, dataMode)
        server = createServer((request, response) => {
            setSecurityHeaders(response)
            void serveStatic(request, response)
        })
        return new Promise((resolve) => {
            server!.listen(0, '127.0.0.1', () => {
                const address = server!.address()
                if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP.')
                resolve(`http://127.0.0.1:${address.port}`)
            })
        })
    }
})