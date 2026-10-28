import type { Theme } from '@fluentui/react-components'

export const uiFontScale = 0.95

const fontSizeTokens = [
    'fontSizeBase100', 'fontSizeBase200', 'fontSizeBase300', 'fontSizeBase400', 'fontSizeBase500', 'fontSizeBase600',
    'fontSizeHero700', 'fontSizeHero800', 'fontSizeHero900', 'fontSizeHero1000'
] as const

export function scaleFontTheme(theme: Theme, scale = uiFontScale): Theme {
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Font scale must be a positive finite number.')
    const scaled: Theme = { ...theme }
    for (const token of fontSizeTokens) {
        if (!/^\d*\.?\d+px$/.test(theme[token])) throw new Error(`Unsupported font-size token: ${token}. Expected pixels.`)
        scaled[token] = `${Number((Number.parseFloat(theme[token]) * scale).toFixed(3))}px`
    }
    return scaled
}
