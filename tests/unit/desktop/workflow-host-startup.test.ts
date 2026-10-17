import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop workflow host startup', () => {
    it('isolates the Sample browser session before asynchronous startup without moving user data', async () => {
        const mainSource = await readFile(resolve('apps/desktop/electron/main/index.ts'), 'utf8')
        const sampleMode = mainSource.indexOf("if (dataMode === 'sample') {")
        const sessionDirectory = mainSource.indexOf("const sampleSessionDirectory = resolve(app.getPath('userData'), 'sample-session')")
        const createDirectory = mainSource.indexOf('mkdirSync(sampleSessionDirectory, { recursive: true })')
        const setSessionPath = mainSource.indexOf("app.setPath('sessionData', sampleSessionDirectory)")
        const asynchronousStartup = mainSource.indexOf('await prepareFoundryEnvironmentFile(')

        expect(sampleMode).toBeGreaterThan(-1)
        expect(sessionDirectory).toBeGreaterThan(sampleMode)
        expect(createDirectory).toBeGreaterThan(sessionDirectory)
        expect(setSessionPath).toBeGreaterThan(createDirectory)
        expect(asynchronousStartup).toBeGreaterThan(setSessionPath)
        expect(mainSource).not.toContain("app.setPath('userData'")
    })

    it('initializes the workflow host before registering IPC handlers', async () => {
        const mainSource = await readFile(resolve('apps/desktop/electron/main/index.ts'), 'utf8')
        const hostInitialization = mainSource.indexOf(
            'const workflowHost = configuredWorkflowHost?.host ?? createSampleWorkflowHost('
        )
        const ipcRegistration = mainSource.indexOf('registerIpc()')

        expect(hostInitialization).toBeGreaterThan(-1)
        expect(ipcRegistration).toBeGreaterThan(hostInitialization)
    })
})