import type { Server } from 'node:http'

export function listenWebServer(server: Server, port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleError = (error: NodeJS.ErrnoException) => {
            server.off('listening', handleListening)
            if (error.code === 'EADDRINUSE') {
                reject(new Error(`Port ${port} on ${host} is already in use. Stop the existing web host or set PORT to another value.`))
                return
            }
            reject(error)
        }
        const handleListening = () => {
            server.off('error', handleError)
            resolve()
        }

        server.once('error', handleError)
        server.once('listening', handleListening)
        server.listen(port, host)
    })
}