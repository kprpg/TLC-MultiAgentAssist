import { build } from 'vite'
import { resolve } from 'node:path'

export default async function () {
  await build({ configFile: resolve('tests', 'fixtures', 'performance', 'vite.config.ts') })
}
