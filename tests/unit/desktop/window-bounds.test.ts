import { describe, expect, it } from 'vitest'
import { desktopWindowBounds } from '../../../apps/desktop/electron/main/window-bounds.js'

describe('desktopWindowBounds', () => {
    it.each([
        { x: 0, y: 0, width: 1920, height: 1040 },
        { x: 0, y: 0, width: 1366, height: 728 },
        { x: 0, y: 48, width: 1024, height: 552 },
        { x: -1366, y: 40, width: 1366, height: 688 }
    ])('fits the window and its minimum size inside work area $width x $height', (workArea) => {
        const bounds = desktopWindowBounds(workArea)

        expect(bounds.width).toBe(Math.min(1440, workArea.width))
        expect(bounds.height).toBe(Math.min(900, workArea.height))
        expect(bounds.minWidth).toBe(Math.min(1080, workArea.width))
        expect(bounds.minHeight).toBe(Math.min(720, workArea.height))
        expect(bounds.x).toBeGreaterThanOrEqual(workArea.x)
        expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height)
    })
})
