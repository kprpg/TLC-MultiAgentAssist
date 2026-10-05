import { globSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    workspaces: string[]
}
const lockfile = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { name?: string; version?: string; resolved?: string; link?: boolean }>
}
const workspaceManifests = globSync(manifest.workspaces.map((workspace) => `${workspace}/package.json`), {
    cwd: repositoryRoot
})

describe('workspace lock integrity', () => {
    it.each(workspaceManifests)('locks the manifest and link for %s', (manifestPath) => {
        const workspacePath = dirname(manifestPath).split(sep).join('/')
        const workspace = JSON.parse(readFileSync(join(repositoryRoot, manifestPath), 'utf8')) as {
            name: string
            version: string
        }

        expect(lockfile.packages[workspacePath]).toMatchObject({
            name: workspace.name,
            version: workspace.version
        })
        expect(lockfile.packages[`node_modules/${workspace.name}`]).toEqual({
            resolved: workspacePath,
            link: true
        })
    })
})
