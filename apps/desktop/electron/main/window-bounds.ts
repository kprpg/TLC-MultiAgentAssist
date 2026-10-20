import type { Rectangle } from 'electron'

export function desktopWindowBounds(workArea: Rectangle) {
    const width = Math.min(1440, workArea.width)
    const height = Math.min(900, workArea.height)
    return {
        x: workArea.x + Math.floor((workArea.width - width) / 2),
        y: workArea.y + Math.floor((workArea.height - height) / 2),
        width,
        height,
        minWidth: Math.min(1080, workArea.width),
        minHeight: Math.min(720, workArea.height)
    }
}
