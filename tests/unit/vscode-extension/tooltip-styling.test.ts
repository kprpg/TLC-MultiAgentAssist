import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const customTooltipSelectors = ['.info-popover', '.agent-tab-tooltip', '.record-hover-tooltip'] as const

function styleBlock(styles: string, selector: string): string {
  const start = styles.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = styles.indexOf('}', start)
  expect(end).toBeGreaterThan(start)
  return styles.slice(start, end)
}

describe('VS Code tooltip styling', () => {
  it('uses a high-contrast workspace palette for native hover widgets', async () => {
    const settings = JSON.parse(await readFile(resolve('.vscode', 'settings.json'), 'utf8')) as {
      'workbench.colorCustomizations'?: Record<string, string>
    }

    expect(settings['workbench.colorCustomizations']).toEqual({
      'editorHoverWidget.background': '#0B2538',
      'editorHoverWidget.foreground': '#B3DDFF',
      'editorHoverWidget.border': '#2F9BC1'
    })
  })

  it('reuses the native palette with semibold text for TLC webview popups', async () => {
    const styles = await readFile(resolve('apps', 'vscode-extension', 'src', 'webview', 'styles.css'), 'utf8')

    expect(styles).toContain('--tlc-tooltip-background: var(--vscode-editorHoverWidget-background')
    expect(styles).toContain('--tlc-tooltip-border: var(--vscode-editorHoverWidget-border')
    expect(styles).toContain('--tlc-tooltip-foreground: var(--vscode-editorHoverWidget-foreground')

    for (const selector of customTooltipSelectors) {
      const block = styleBlock(styles, selector)
      expect(block).toContain('background: var(--tlc-tooltip-background);')
      expect(block).toContain('border: 1px solid var(--tlc-tooltip-border);')
      expect(block).toContain('color: var(--tlc-tooltip-foreground);')
      expect(block).toContain('font-weight: var(--tlc-tooltip-font-weight);')
    }
  })
})
