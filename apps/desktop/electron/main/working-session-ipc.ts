import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { workingSessionOpenFolderRequestSchema, workingSessionResultSchema, workingSessionTopicResponseSchema } from '../../../../packages/common/contracts/working-session.js'
import type { WorkingSessionService } from '../../../../packages/orchestrator/working-session/index.js'

export const workingSessionTopicIpcChannel = 'tlc:working-session-topic'
export const workingSessionPrepareIpcChannel = 'tlc:working-session-prepare'
export const workingSessionOpenIpcChannel = 'tlc:working-session-open'

export interface WorkingSessionIpcDependencies {
  documentsFolder(): string
  openPath(path: string): Promise<string>
}

/** Validated adapters only: the renderer can open a folder only if it is a directory under Documents\TLC. */
export function createWorkingSessionIpcHandlers(service: WorkingSessionService, dependencies: WorkingSessionIpcDependencies) {
  return {
    topic: async (input: unknown) => workingSessionTopicResponseSchema.parse(await service.deriveTopic(input)),
    prepare: async (input: unknown) => workingSessionResultSchema.parse(await service.prepare(input)),
    open: async (input: unknown): Promise<void> => {
      const { folderPath } = workingSessionOpenFolderRequestSchema.parse(input)
      const root = resolve(dependencies.documentsFolder(), 'TLC')
      const target = resolve(folderPath)
      if (!target.toLowerCase().startsWith(root.toLowerCase() + sep)) throw new Error('Only working-session folders under Documents\\TLC can be opened.')
      if (!(await stat(target).catch(() => undefined))?.isDirectory()) throw new Error('The working-session folder was not found.')
      if (await dependencies.openPath(target)) throw new Error('The working-session folder could not be opened.')
    }
  }
}
