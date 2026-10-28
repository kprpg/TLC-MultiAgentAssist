import { describe, expect, it } from 'vitest'
import { preprocessCSS, resolveConfig } from 'vite'
import { fontScalePlugin } from '../../../apps/shared/postcss-font-scale.js'

async function transform(css: string, scale = 0.95) {
    const config = await resolveConfig({
        configFile: false, css: { postcss: { plugins: [fontScalePlugin(scale)] } }
    }, 'build')
    return (await preprocessCSS(css, 'typography.css', config)).code
}

describe('shared CSS font scaling', () => {
    it('scales pixel, rem and Fluent font declarations but leaves layout and references unchanged', async () => {
        const css = await transform('.text{font-size:14px;--fontSizeBase300:14px;line-height:20px;padding:14px;gap:1rem}.rem{font-size:0.85rem}.token{font-size:var(--fontSizeBase300)}')
        expect(css).toContain('font-size:13.3px')
        expect(css).toContain('--fontSizeBase300:13.3px')
        expect(css).toContain('font-size:0.807rem')
        for (const declaration of ['line-height:20px', 'padding:14px', 'gap:1rem', 'font-size:var(--fontSizeBase300)']) {
            expect(css).toContain(declaration)
        }
    })

    it('keeps inherited, parent-relative and already-scaled token expressions proportional', async () => {
        const source = '.em{font-size:0.9em}.percent{font-size:85%}.inherit{font:inherit}.relative{font-size:calc(var(--fontSizeBase300) * 0.85)}'
        expect(await transform(source)).toBe(source)
    })

    it('scales the host font setting without changing its fallback or modifying host-owned variables', async () => {
        const css = await transform('body{font-size:var(--vscode-font-size, 13px)}')
        expect(css).toContain('font-size:calc(var(--vscode-font-size, 13px) * 0.95)')
        expect(css).not.toContain('--vscode-font-size:')
    })

    it('scales every responsive clamp branch without scaling layout clamps', async () => {
        const css = await transform('.hero{font-size:clamp(28px, 4vw, 42px);padding:clamp(12px, 4vw, 24px)}')
        expect(css).toContain('font-size:calc(clamp(28px, 4vw, 42px) * 0.95)')
        expect(css).toContain('padding:clamp(12px, 4vw, 24px)')
    })

    it('reduces previously unscaled native controls only once even in the cumulative Desktop build', async () => {
        const css = await transform(':root{--tlc-native-control-font-size:13.333333px}:where(input,select,textarea){font-size:var(--tlc-native-control-font-size)}', 0.9025)
        expect(css).toContain('--tlc-native-control-font-size:12.667px')
        expect(css).toContain('font-size:var(--tlc-native-control-font-size)')
    })

    it('does not compound the reduction when rebuilding unchanged source CSS', async () => {
        const source = '.text{font-size:14px;--fontSizeBase300:14px}'
        expect(await transform(source, 0.9025)).toBe(await transform(source, 0.9025))
        expect(source).toBe('.text{font-size:14px;--fontSizeBase300:14px}')
    })

    it('rejects an invalid native-control baseline instead of emitting an unscaled fallback', async () => {
        await expect(transform(':root{--tlc-native-control-font-size:inherit}')).rejects.toThrow('Native control font size must be an absolute CSS length.')
    })

    it.each([0, -0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid scale %s', (scale) => {
        expect(() => fontScalePlugin(scale)).toThrow('Font scale must be a positive finite number.')
    })
})
