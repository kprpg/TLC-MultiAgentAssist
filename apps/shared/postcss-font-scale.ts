import { uiFontScale } from './font-scale.js'

const fontDeclaration = /^(?:font-size|--fontSize[A-Za-z0-9]+)$/
const absoluteLength = /^(\d*\.?\d+)(px|rem)$/
const hostFont = /^var\(--vscode-font-size(?:,\s*\d*\.?\d+px)?\)$/
const absoluteClamp = /^clamp\((?:\s*\d*\.?\d+(?:px|rem|vw)\s*,){2}\s*\d*\.?\d+(?:px|rem|vw)\s*\)$/

interface Declaration {
    prop: string
    value: string
}

export function fontScalePlugin(scale: number) {
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Font scale must be a positive finite number.')
    return {
        postcssPlugin: 'tlc-font-scale',
        Once(root: { walkDecls: (callback: (declaration: Declaration) => void) => void }) {
            root.walkDecls((declaration) => {
                const nativeControl = declaration.prop === '--tlc-native-control-font-size'
                if (!nativeControl && !fontDeclaration.test(declaration.prop)) {
                    return
                }
                const value = declaration.value.trim()
                const match = absoluteLength.exec(value)
                if (nativeControl && !match) throw new Error('Native control font size must be an absolute CSS length.')
                if (match?.[1] && match[2]) {
                    // Native controls were not included in the previous Desktop/Web reduction.
                    const factor = nativeControl ? uiFontScale : scale
                    declaration.value = `${Number((Number(match[1]) * factor).toFixed(3))}${match[2]}`
                } else if (hostFont.test(value) || absoluteClamp.test(value)) {
                    declaration.value = `calc(${value} * ${scale})`
                }
            })
        }
    }
}
