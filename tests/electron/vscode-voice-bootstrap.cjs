const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const childProcess = require('node:child_process')
const vscode = require('vscode')

exports.run = async function () {
    const directory = process.env.TLC_VOICE_TEST_DIRECTORY
    let inputFile = process.env.TLC_VOICE_TEST_AUDIO
    if (!directory || !inputFile) throw new Error('The isolated voice test paths are required.')
    const originalSpawn = childProcess.spawn
    childProcess.spawn = function (command, args, options) {
        const child = originalSpawn(command, args, options)
        const index = Array.isArray(args) ? args.indexOf('-EncodedCommand') : -1
        if (index >= 0 && typeof args[index + 1] === 'string' &&
            Buffer.from(args[index + 1], 'base64').toString('utf16le').includes('[TlcOfflineVoice]::Run()')) {
            const originalWrite = child.stdin.write.bind(child.stdin)
            let first = true
            child.stdin.write = function (chunk, encoding, callback) {
                if (first) {
                    first = false
                    const configuration = JSON.parse(String(chunk))
                    chunk = `${JSON.stringify({ ...configuration, waveFile: inputFile })}\n`
                }
                return originalWrite(chunk, encoding, callback)
            }
        }
        return child
    }
    const extension = vscode.extensions.getExtension('tlc.tlc-assist-vscode')
    if (!extension) throw new Error('The actual TLC extension did not load.')
    await extension.activate()
    await vscode.commands.executeCommand('tlc.open')
    await new Promise((resolve, reject) => {
        const server = http.createServer((request, response) => {
            let content = ''
            request.setEncoding('utf8')
            request.on('data', (data) => { content += data })
            request.on('end', () => {
                if (request.url === '/audio' && request.method === 'POST') {
                    const next = JSON.parse(content)
                    if (typeof next.inputFile !== 'string' || !fs.existsSync(next.inputFile)) {
                        response.statusCode = 400
                        response.end('A recorded test audio path is required.')
                        return
                    }
                    inputFile = next.inputFile
                    response.end('ready')
                } else if (request.url === '/finish') {
                    childProcess.spawn = originalSpawn
                    response.end('finished')
                    server.close(resolve)
                } else response.end('ready')
            })
        })
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            fs.writeFileSync(path.join(directory, 'bridge.json'), JSON.stringify({ url: `http://127.0.0.1:${address.port}` }))
        })
    })
}
