import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop workflow host startup', () => {
    it('initializes the workflow host before registering IPC handlers', async () => {
        const mainSource = await readFile(resolve('apps/desktop/electron/main/index.ts'), 'utf8')
        const hostInitialization = mainSource.indexOf(
            'const workflowHost = configuredWorkflowHost?.host ?? createSampleWorkflowHost()'
        )
        const ipcRegistration = mainSource.indexOf('registerIpc()')

        expect(hostInitialization).toBeGreaterThan(-1)
        expect(ipcRegistration).toBeGreaterThan(hostInitialization)
    })
})