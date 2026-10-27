import { describe, expect, it } from 'vitest'
import launch from '../../../.vscode/launch.json' with { type: 'json' }

const isolatedName = 'Run TLC Assist Extension (isolated)'

describe('VS Code extension F5 profiles', () => {
  it('isolates the standard launch without changing its build, data mode, or storage settings', () => {
    const standard = launch.configurations.find(({ name }) => name === 'Run TLC Assist Extension')
    if (!standard?.args) throw new Error('The standard extension launch profile must exist with its arguments.')

    const isolated = launch.configurations.filter(({ name }) => name === isolatedName)
    expect(isolated).toEqual([{
      ...standard,
      name: isolatedName,
      args: ['--disable-extensions', ...standard.args]
    }])
  })

  it('keeps the existing profiles available with installed extensions enabled', () => {
    const existing = launch.configurations.filter(({ type, name }) => type === 'extensionHost' && name !== isolatedName)
    expect(existing.map(({ name }) => name)).toEqual([
      'Run TLC Assist Extension',
      'Run TLC Assist Extension (SQLite test store)',
      'Run TLC Assist Extension (SQLite + Foundry extraction)',
      'Run TLC Assist Extension (Live MSX/Dataverse)',
      'TLC Assist Extension Tests'
    ])
    for (const configuration of existing) {
      expect(configuration.args).not.toContain('--disable-extensions')
    }
  })
})
