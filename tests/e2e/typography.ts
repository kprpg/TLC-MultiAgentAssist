import { expect, type Locator, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

interface TypographySample {
    fontSize: number
    fontFamily: string
    fontWeight: string
    lineHeight: string
    padding: string
    gap: string
    width: number
    height: number
    zoom: string
}

export async function captureTypography(info: TestInfo, elements: Record<string, Locator>, name = 'typography') {
    const samples: Record<string, TypographySample> = {}
    for (const [label, element] of Object.entries(elements)) {
        await expect(element).toBeVisible()
        samples[label] = await element.evaluate((node) => {
            const style = getComputedStyle(node)
            const bounds = node.getBoundingClientRect()
            return {
                fontSize: Number.parseFloat(style.fontSize), fontFamily: style.fontFamily, fontWeight: style.fontWeight,
                lineHeight: style.lineHeight, padding: style.padding, gap: style.gap,
                width: bounds.width, height: bounds.height, zoom: style.zoom
            }
        })
    }
    const path = info.outputPath(`${name}.json`)
    await writeFile(path, JSON.stringify(samples, null, 2))
    await info.attach(name, { path, contentType: 'application/json' })
    return samples
}

export function expectFontReduction(samples: Record<string, TypographySample>, before: Record<string, number>) {
    for (const sample of Object.values(samples)) expect(sample.zoom).toBe('1')
    for (const [label, fontSize] of Object.entries(before)) {
        const sample = samples[label]
        if (!sample) throw new Error(`Missing typography sample: ${label}`)
        expect(Math.abs(sample.fontSize - fontSize * 0.95), `${label}: additional 5% font reduction`).toBeLessThanOrEqual(0.01)
    }
}
