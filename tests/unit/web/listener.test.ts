import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { listenWebServer } from '../../../apps/web/src/listener.js'

describe('web server listener', () => {
    let occupiedServer: Server | undefined

    afterEach(async () => {
        if (occupiedServer?.listening) {
            await new Promise<void>((resolve, reject) => occupiedServer!.close((error) => error ? reject(error) : resolve()))
        }
        occupiedServer = undefined
    })

    it('reports an actionable error when the requested port is occupied', async () => {
        occupiedServer = createServer()
        await listenWebServer(occupiedServer, 0, '127.0.0.1')
        const address = occupiedServer.address()
        if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP.')

        const conflictingServer = createServer()
        await expect(listenWebServer(conflictingServer, address.port, '127.0.0.1')).rejects.toThrow(
            `Port ${address.port} on 127.0.0.1 is already in use. Stop the existing web host or set PORT to another value.`
        )
    })
})