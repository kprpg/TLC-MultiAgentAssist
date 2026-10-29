import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { scaleFontTheme, uiFontScale } from '../../../apps/shared/font-scale.js'

// The Node ESM barrel includes Tabster's browser-only named exports.
const { teamsDarkTheme, teamsHighContrastTheme, teamsLightTheme, webDarkTheme, webLightTheme }: typeof import('@fluentui/react-components') =
    createRequire(import.meta.url)('@fluentui/react-components')

describe('shared typography scale', () => {
    it('applies exactly an additional five percent reduction', () => {
        expect(uiFontScale).toBe(0.95)
    })

    it.each([
        ['Web light', webLightTheme], ['Web dark', webDarkTheme],
        ['Teams light', teamsLightTheme], ['Teams dark', teamsDarkTheme], ['Teams high contrast', teamsHighContrastTheme]
    ] as const)('scales all %s font tokens without mutating the theme or other tokens', (_name, theme) => {
        const original = Object.freeze({ ...theme })
        const scaled = scaleFontTheme(original)
        expect(scaled).not.toBe(original)
        for (const [token, value] of Object.entries(original)) {
            if (token.startsWith('fontSize')) {
                if (typeof value !== 'string') throw new Error(`Font-size token ${token} must be a CSS length.`)
                expect(scaled).toHaveProperty(token, `${Number((Number.parseFloat(value) * 0.95).toFixed(3))}px`)
            } else {
                expect(scaled).toHaveProperty(token, value)
            }
        }
        expect(original).toEqual(theme)
    })

    it('preserves the previous Desktop reduction instead of replacing it', () => {
        expect(scaleFontTheme(webLightTheme, 0.95 * uiFontScale).fontSizeBase300).toBe('12.635px')
        expect(scaleFontTheme(webLightTheme, 0.95 * uiFontScale).lineHeightBase300).toBe(webLightTheme.lineHeightBase300)
    })

    it.each([0, -0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid scale %s', (scale) => {
        expect(() => scaleFontTheme(webLightTheme, scale)).toThrow('Font scale must be a positive finite number.')
    })

    it('rejects unsupported token units instead of silently turning them into pixels', () => {
        expect(() => scaleFontTheme({ ...webLightTheme, fontSizeBase300: '1rem' })).toThrow('fontSizeBase300')
    })
})
