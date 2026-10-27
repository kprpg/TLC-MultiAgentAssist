import { expect, type Locator } from '@playwright/test'

export async function expectTextContrast(element: Locator): Promise<void> {
    const contrast = await element.evaluate((element) => {
        function rgba(value: string) {
            const [red, green, blue, alpha = 1] = value.match(/[\d.]+/g)?.map(Number) ?? []
            if (red === undefined || green === undefined || blue === undefined) throw new Error(`Unsupported rendered color: ${value}`)
            return { red, green, blue, alpha }
        }
        const ancestors: Element[] = []
        for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current)
        let background = { red: 255, green: 255, blue: 255 }
        for (const ancestor of ancestors) {
            const layer = rgba(getComputedStyle(ancestor).backgroundColor)
            background = {
                red: layer.red * layer.alpha + background.red * (1 - layer.alpha),
                green: layer.green * layer.alpha + background.green * (1 - layer.alpha),
                blue: layer.blue * layer.alpha + background.blue * (1 - layer.alpha)
            }
        }
        function luminance(color: { red: number; green: number; blue: number }) {
            const linear = (channel: number) => channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4
            return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
        }
        const foregroundLuminance = luminance(rgba(getComputedStyle(element).color))
        const backgroundLuminance = luminance(background)
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
}
