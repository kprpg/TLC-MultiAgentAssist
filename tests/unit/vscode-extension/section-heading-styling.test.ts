import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webview = (file: string): string => resolve('apps', 'vscode-extension', 'src', 'webview', file)

function styleBlock(styles: string, selector: string): string {
  const start = styles.indexOf(`${selector} {`)
  expect(start, `missing selector ${selector}`).toBeGreaterThanOrEqual(0)
  const end = styles.indexOf('}', start)
  expect(end).toBeGreaterThan(start)
  return styles.slice(start, end)
}

describe('Portfolio section heading styling', () => {
  it('defines a dedicated heading color distinct from data and link colors', async () => {
    const styles = await readFile(webview('styles.css'), 'utf8')

    expect(styles).toContain('--tlc-section-heading-foreground: var(--vscode-terminal-ansiBrightCyan, #4ec9b0);')

    const heading = styleBlock(styles, '.section-heading')
    expect(heading).toContain('color: var(--tlc-section-heading-foreground);')
    expect(heading).toContain('font-weight: 700;')

    const eyebrow = styleBlock(styles, '.eyebrow')
    expect(eyebrow).toContain('color: var(--tlc-section-heading-foreground);')
  })

  it('tags only static category headers, never customer/opportunity data', async () => {
    const app = await readFile(webview('app.tsx'), 'utf8')

    expect(app).toContain('<h3 className="section-heading">Accounts</h3>')
    expect(app).toContain('<h3 className="section-heading">Opportunities</h3>')
    expect(app).toContain('<h4 className="section-heading">Milestones</h4>')

    // The selected opportunity name is data and must keep plain (unclassed) styling.
    expect(app).toContain('<h3>{selectedOpportunity.name}</h3>')
  })

  it('tags the Next Best Actions panel heading', async () => {
    const nextBest = await readFile(webview('next-best-actions.tsx'), 'utf8')
    expect(nextBest).toContain('id="next-best-actions-title" className="section-heading"')
    // The recommendation action remains data text.
    expect(nextBest).toContain('<h4>{recommendation.action}</h4>')
  })
})
