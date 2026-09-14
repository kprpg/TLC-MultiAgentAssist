import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const sourcePath = resolve('docs/user-guide/media/TCLAcctAssist.png')
const outputPath = resolve('apps/desktop/build/icon.png')
const iconSize = 512

export async function generateDesktopIcon(source = sourcePath, output = outputPath) {
  const sourceImage = await loadImage(source)
  if (sourceImage.width !== sourceImage.height) {
    throw new Error(`Desktop icon source must be square; received ${sourceImage.width}x${sourceImage.height}.`)
  }

  const canvas = createCanvas(iconSize, iconSize)
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(sourceImage, 0, 0, iconSize, iconSize)

  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, canvas.toBuffer('image/png'))
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateDesktopIcon()
}