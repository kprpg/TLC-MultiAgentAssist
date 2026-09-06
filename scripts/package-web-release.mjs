import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function packageWebRelease(outputRoot = join(repositoryRoot, 'release-web', 'package'), sourceRoot = repositoryRoot) {
  const rootPackage = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  const webPackage = JSON.parse(await readFile(join(sourceRoot, 'apps', 'web', 'package.json'), 'utf8'))
  const desktopPackage = JSON.parse(await readFile(join(sourceRoot, 'apps', 'desktop', 'package.json'), 'utf8'))

  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })

  await copy('apps/web/dist', outputRoot)
  await copy('apps/desktop/dist/revamp', join(outputRoot, 'apps/desktop/dist/revamp'))
  await copy('docs/knowledge/MCEM Overview.pdf', join(outputRoot, 'docs/knowledge/MCEM Overview.pdf'))
  await copy('config/foundry.environment.example.json', join(outputRoot, 'config/foundry.environment.example.json'))

  const releasePackage = {
    name: '@tlc/web-release',
    version: webPackage.version,
    private: true,
    type: 'module',
    engines: rootPackage.engines,
    scripts: { start: 'node server.js' },
    dependencies: {
      ...rootPackage.dependencies,
      ...desktopPackage.dependencies,
      ...webPackage.dependencies
    }
  }
  await writeFile(join(outputRoot, 'package.json'), `${JSON.stringify(releasePackage, null, 2)}\n`)
  await writeFile(join(outputRoot, 'web.config'), webConfig)
  return outputRoot

  async function copy(source, destination) {
    const resolvedDestination = resolve(destination)
    await mkdir(dirname(resolvedDestination), { recursive: true })
    await cp(join(sourceRoot, source), resolvedDestination, { recursive: true })
  }
}

const webConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <handlers>
      <add name="iisnode" path="server.js" verb="*" modules="iisnode" />
    </handlers>
    <rewrite>
      <rules>
        <rule name="DynamicContent">
          <match url=".*" />
          <action type="Rewrite" url="server.js" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputRoot = process.argv[2] ? resolve(process.argv[2]) : undefined
  console.info(`Web release package staged at ${await packageWebRelease(outputRoot)}`)
}