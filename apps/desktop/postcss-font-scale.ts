const fontDeclaration = /^(?:font-size|--fontSize[A-Za-z0-9]+)$/
const absoluteLength = /^(\d*\.?\d+)(px|rem)$/

interface Declaration {
    prop: string
    value: string
}

// Scales absolute font sizes at build time so the Desktop and Web renderer shrinks proportionally
// without touching the shared CSS that the VS Code webview and Teams also consume.
export function fontScalePlugin(scale: number) {
    return {
        postcssPlugin: 'tlc-font-scale',
        Once(root: { walkDecls: (callback: (declaration: Declaration) => void) => void }) {
            root.walkDecls((declaration) => {
                if (!fontDeclaration.test(declaration.prop)) {
                    return
                }
                const match = absoluteLength.exec(declaration.value.trim())
                if (match?.[1] && match[2]) {
                    declaration.value = `${Number((Number(match[1]) * scale).toFixed(3))}${match[2]}`
                }
            })
        }
    }
}
