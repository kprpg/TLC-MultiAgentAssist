const assert = require('node:assert')
const vscode = require('vscode')

suite('TLC Assist extension', () => {
    test('activates and registers its commands', async () => {
        const extension = vscode.extensions.getExtension('tlc.tlc-assist-vscode')
        assert.ok(extension, 'extension is installed in the development host')
        await extension.activate()
        const commands = await vscode.commands.getCommands(true)
        for (const id of ['tlc.open', 'tlc.refresh', 'tlc.runPlay', 'tlc.openRun', 'tlc.showConnection', 'tlc.testLiveConnection']) {
            assert.ok(commands.includes(id), `command ${id} is registered`)
        }
    })

    test('opens the workbench without throwing', async () => {
        await vscode.commands.executeCommand('tlc.open')
    })

    test('refresh command runs without throwing', async () => {
        await vscode.commands.executeCommand('tlc.refresh')
    })

    test('declares untrusted-workspace support', () => {
        const extension = vscode.extensions.getExtension('tlc.tlc-assist-vscode')
        assert.ok(extension, 'extension is installed in the development host')
        assert.strictEqual(extension.packageJSON.capabilities.untrustedWorkspaces.supported, true)
    })
})
