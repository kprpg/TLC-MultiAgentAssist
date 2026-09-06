import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

export function buildStaticHandler(staticRoot: string, dataMode: 'live' | 'sample' = 'live') {
    const resolvedRoot = resolve(staticRoot)
    return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.statusCode = 405
            response.end()
            return
        }

        const url = new URL(request.url ?? '/', 'http://localhost')
        const requestedPath = decodeURIComponent(url.pathname)
        const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '')
        let filePath = resolve(resolvedRoot, relativePath)
        if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${sep}`)) {
            response.statusCode = 404
            response.end()
            return
        }

        if (!(await isFile(filePath))) filePath = resolve(resolvedRoot, 'index.html')
        let content = await readFile(filePath)
        if (filePath.endsWith('index.html')) {
            if (dataMode === 'live') {
                content = Buffer.from(content.toString('utf8').replace(
                    '</head>',
                    '    <meta name="tlc-data-mode" content="live" />\n  </head>'
                ))
            }
            response.setHeader('cache-control', 'no-store')
        } else {
            response.setHeader('cache-control', 'public, max-age=31536000, immutable')
        }
        response.setHeader('content-type', contentType(filePath))
        response.statusCode = 200
        response.end(request.method === 'HEAD' ? undefined : content)
    }
}

export function setSecurityHeaders(response: ServerResponse): void {
    response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('x-frame-options', 'DENY')
}

async function isFile(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile()
    } catch {
        return false
    }
}

function contentType(filePath: string): string {
    return ({
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml'
    } as Record<string, string>)[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}