import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import manifest from '../../../apps/vscode-extension/package.json' with { type: 'json' }

const actions = [
  ['tlc.refresh', 'TLC: Refresh Data', 'refresh'],
  ['tlc.addCustomer', 'TLC: Add Customer Account', 'add'],
  ['tlc.toggleHiddenCustomers', 'TLC: Toggle Hidden Customers', 'eye'],
  ['tlc.hideCustomer', 'Hide Customer', 'eye-hidden'],
  ['tlc.unhideCustomer', 'Unhide Customer', 'eye']
] as const

describe('native VS Code action icons', () => {
  it.each(actions)('gives %s a colored icon without changing its accessible label', (id, title, icon) => {
    const command = manifest.contributes.commands.find((candidate) => candidate.command === id)
    expect(command?.title).toBe(title)
    expect(command?.icon).toEqual({
      light: `media/actions/${icon}-light.svg`,
      dark: `media/actions/${icon}-dark.svg`
    })
  })

  it.each(['light', 'dark'] as const)('ships blue, renderable icons for the %s theme', async (theme) => {
    for (const icon of ['refresh', 'add', 'eye', 'eye-hidden']) {
      const svg = await readFile(resolve('apps', 'vscode-extension', 'media', 'actions', `${icon}-${theme}.svg`))
      expect(svg.toString()).toContain(theme === 'light' ? '#006ab1' : '#b3ddff')
      expect(svg.toString()).not.toMatch(/<script|<image|href=|url\(/i)
      const image = await loadImage(svg)
      expect([image.width, image.height]).toEqual([16, 16])
      const canvas = createCanvas(16, 16)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, 16, 16).data
      let bluePixels = 0
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const red = pixels[offset]!
        const green = pixels[offset + 1]!
        const blue = pixels[offset + 2]!
        if (pixels[offset + 3]! > 128 && blue > green && green > red) bluePixels += 1
      }
      expect(bluePixels).toBeGreaterThanOrEqual(8)
    }
  })
})
