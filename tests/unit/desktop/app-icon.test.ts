import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'

describe('desktop application icon', () => {
    it('configures a packaged, Windows-compatible custom icon', async () => {
        const packageJson = JSON.parse(await readFile(resolve('apps/desktop/package.json'), 'utf8')) as {
            build: { files: string[]; win: { icon?: string } }
        }
        const iconPath = packageJson.build.win.icon

        expect(iconPath).toBe('build/icon.png')
        expect(packageJson.build.files).toContain(iconPath)

        const icon = await loadImage(resolve('apps/desktop', iconPath!))
        expect(icon.width).toBeGreaterThanOrEqual(256)
        expect(icon.height).toBe(icon.width)

        const mainSource = await readFile(resolve('apps/desktop/electron/main/index.ts'), 'utf8')
        expect(mainSource).toContain("const appIcon = resolve(desktopRoot, 'build/icon.png')")
        expect(mainSource).toContain('icon: appIcon')
    })
})