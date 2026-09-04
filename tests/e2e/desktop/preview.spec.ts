import { expect, test, _electron as electron } from '@playwright/test'
import type { WebContents } from 'electron'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('launches the secure MCEM operational workbench', async () => {
  test.setTimeout(60_000)
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'tlc-electron-test-'))
  const app = await electron.launch({
    args: [resolve('apps/desktop'), `--user-data-dir=${userDataDirectory}`],
    env: {
      ...process.env,
      TLC_DATA_MODE: 'sample'
    }
  })

  try {
    const window = await app.firstWindow()
    const pageErrors: Error[] = []
    window.on('pageerror', (error) => pageErrors.push(error))
    await expect(window).toHaveTitle('TLC Account Team Intelligence')
    await window.evaluate(() => {
      localStorage.removeItem('tlc-left-pane-collapsed')
      localStorage.removeItem('tlc-right-pane-collapsed')
      localStorage.removeItem('tlc-source-notice-v2-dismissed')
    })
    await window.reload()
    await expect(window.getByText('SAMPLE DATA')).toBeVisible()
    const sourceNotice = window.locator('.sample-notice')
    const workspaceTopWithNotice = (await window.locator('.workspace').boundingBox())!.y
    await expect(sourceNotice).toBeVisible()
    await window.getByRole('button', { name: 'Dismiss data source notice' }).click()
    await expect(sourceNotice).toHaveCount(0)
    expect((await window.locator('.workspace').boundingBox())!.y).toBeLessThan(workspaceTopWithNotice)
    await window.reload()
    await expect(sourceNotice).toHaveCount(0)
    await expect(window.getByText('Evidence supports', { exact: true })).toBeVisible()
    await expect(window.getByText('NEXT BEST ACTIONS')).toBeVisible()
    await expect(window.getByText('Stage 2', { exact: true })).toBeVisible()
    await expect(window.locator('.action-card')).toHaveCount(4)
    await expect(window.locator('.actions-intro')).toContainText('Stage 3 ready')

    const contextToggle = window.getByRole('button', { name: 'Toggle working context' })
    const actionsToggle = window.getByRole('button', { name: 'Toggle next best actions' })
    await expect(window.locator('.topbar > :first-child')).toHaveAttribute('aria-label', 'Toggle working context')
    await expect(window.locator('.topbar > :last-child')).toHaveAttribute('aria-label', 'Toggle next best actions')
    const initialAnalysisWidth = (await window.locator('.analysis-pane').boundingBox())!.width
    await expect(contextToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(actionsToggle).toHaveAttribute('aria-expanded', 'true')
    await contextToggle.click()
    await expect(contextToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(window.locator('.context-rail')).toHaveCount(0)
    expect((await window.locator('.analysis-pane').boundingBox())!.width).toBeGreaterThan(initialAnalysisWidth)
    await actionsToggle.click()
    await expect(actionsToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(window.locator('.actions-pane')).toHaveCount(0)
    await window.reload()
    await expect(contextToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(actionsToggle).toHaveAttribute('aria-expanded', 'false')
    await contextToggle.click()
    await actionsToggle.click()
    await expect(window.locator('.context-rail')).toBeVisible()
    await expect(window.locator('.actions-pane')).toBeVisible()

    const agentTasks = [
      { tab: 'Account Pulse', content: 'Focus this week on the selected opportunity' },
      { tab: 'MCEM Coach', content: 'Use the deterministic MCEM diagnostic' },
      { tab: 'Pursuit & Executive', content: 'Prepare the pursuit around the selected opportunity gaps' },
      { tab: 'Risk & Solution Play', content: 'The selected opportunity has execution risk' }
    ]
    await window.getByRole('tab', { name: 'Foundry Agent', exact: true }).click()
    await expect(window.getByText('ACCOUNT PULSE AGENT', { exact: true })).toBeVisible()
    await expect(window.getByText('FOUNDRY AGENT TASK', { exact: true })).toHaveCount(0)
    await expect(window.getByRole('button', { name: 'What should the account team focus on this week?' })).toBeVisible()
    await expect(window.locator('.agent-prompt-card')).toHaveCount(4)
    await expect(window.getByRole('textbox', { name: 'Agent task' })).toHaveValue('')
    await expect(window.getByRole('button', { name: 'Run Account Pulse' })).toBeInViewport()
    await window.getByRole('button', { name: 'What should the account team focus on this week?' }).click()
    await expect(window.getByRole('textbox', { name: 'Agent task' })).toHaveValue('What should the account team focus on this week?')
    await expect(window.locator('.agent-synthesis-content').getByRole('heading', { name: 'Summary' })).toBeVisible()
    await expect(window.locator('.agent-synthesis-content').getByRole('table')).toBeVisible()
    await expect(window.getByRole('button', { name: 'Send E-mail' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Export' })).toBeVisible()
    await window.getByRole('button', { name: 'Send E-mail' }).click()
    await expect(window.getByRole('dialog', { name: 'Open Outlook message' })).toBeVisible()
    await expect(window.getByText('Review it and press Send in Outlook.')).toBeVisible()
    await window.getByRole('textbox', { name: 'Email recipients' }).fill('recipient@example.com')
    await expect(window.getByRole('button', { name: 'Open in Outlook' })).toBeEnabled()
    await window.getByRole('button', { name: 'Cancel' }).click()
    await expect(window.getByRole('dialog', { name: 'Open Outlook message' })).toHaveCount(0)
    for (const task of agentTasks) {
      await window.getByRole('tab', { name: task.tab }).click()
      await expect(window.getByText(`${task.tab.toUpperCase()} AGENT`, { exact: true })).toBeVisible()
      await expect(window.locator('.agent-prompt-card')).toHaveCount(4)
      await window.locator('.agent-prompt-card').first().click()
      await expect(window.getByText(task.content, { exact: false })).toBeVisible()
      await expect(window.getByText('Agent sample-v1 · MSX + MCEM', { exact: true })).toBeVisible()
      await expect(window.locator('.agent-synthesis')).toBeInViewport()
    }

    await window.getByRole('tab', { name: 'Diagnostic', exact: true }).click()

    await window.evaluate(() => globalThis.scrollTo(0, 0))
    const startingTheme = await window.locator('html').getAttribute('data-theme')
    const nextTheme = startingTheme === 'dark' ? 'light' : 'dark'
    const themeButton = window.getByRole('button', { name: `Use ${nextTheme} mode` })
    const themeBoxBeforeHover = await themeButton.boundingBox()
    expect(themeBoxBeforeHover).not.toBeNull()
    await themeButton.hover()
    expect(await themeButton.boundingBox()).toEqual(themeBoxBeforeHover)
    await expect(window.locator('html')).toHaveAttribute('data-theme', startingTheme!)

    const refreshButton = window.getByRole('button', { name: 'Refresh analysis' })
    const refreshBoxBeforeHover = await refreshButton.boundingBox()
    expect(refreshBoxBeforeHover).not.toBeNull()
    expect(refreshBoxBeforeHover!.width).toBeCloseTo(32, 4)
    expect(refreshBoxBeforeHover!.height).toBeCloseTo(32, 4)
    await refreshButton.hover()
    const refreshBoxAfterHover = await refreshButton.boundingBox()
    expect(refreshBoxAfterHover).not.toBeNull()
    expect(refreshBoxAfterHover!.x).toBeCloseTo(refreshBoxBeforeHover!.x, 4)
    expect(refreshBoxAfterHover!.y).toBeCloseTo(refreshBoxBeforeHover!.y, 4)
    expect(refreshBoxAfterHover!.width).toBeCloseTo(refreshBoxBeforeHover!.width, 4)
    expect(refreshBoxAfterHover!.height).toBeCloseTo(refreshBoxBeforeHover!.height, 4)
    await expect(window.getByText('Stage 2', { exact: true })).toBeVisible()

    const contextRail = window.locator('.context-rail')
    const accountDropdown = contextRail.locator('[role="combobox"]').nth(0)
    const opportunityDropdown = contextRail.locator('[role="combobox"]').nth(1)
    const contextRailBox = await contextRail.boundingBox()
    const accountBox = await accountDropdown.boundingBox()
    const opportunityBox = await opportunityDropdown.boundingBox()
    expect(contextRailBox).not.toBeNull()
    expect(accountBox).not.toBeNull()
    expect(opportunityBox).not.toBeNull()
    expect(accountBox!.x + accountBox!.width).toBeLessThan(contextRailBox!.x + contextRailBox!.width)
    expect(opportunityBox!.x + opportunityBox!.width).toBeLessThan(contextRailBox!.x + contextRailBox!.width)

    await expect(accountDropdown).toContainText('Contoso Energy')
    await accountDropdown.click()
    await expect(window.getByRole('option', { name: 'Fabrikam Retail' })).toBeVisible()
    await window.getByRole('option', { name: 'Fabrikam Retail' }).click()
    await expect(accountDropdown).toContainText('Fabrikam Retail')
    await expect(window.getByRole('heading', { name: 'AI-assisted customer service' })).toBeVisible()
    await expect(window.locator('.action-card')).toHaveCount(3)
    await expect(window.locator('.actions-intro')).toContainText('Stage 2 ready')

    await expect(opportunityDropdown).toContainText('AI-assisted customer service')
    await opportunityDropdown.click()
    await expect(window.getByRole('option', { name: 'AI-assisted customer service' })).toBeVisible()
    await window.getByRole('option', { name: 'AI-assisted customer service' }).click()
    await expect(window.getByText('NEXT BEST ACTIONS')).toBeVisible()
    expect(pageErrors).toEqual([])

    await window.getByRole('button', { name: `Use ${nextTheme} mode` }).click()
    await expect(window.locator('html')).toHaveAttribute('data-theme', nextTheme)
    await window.reload()
    await expect(window.locator('html')).toHaveAttribute('data-theme', nextTheme)
    await expect(window.getByRole('button', { name: `Use ${startingTheme} mode` })).toBeVisible()

    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const [mainWindow] = BrowserWindow.getAllWindows()
      const webContents = mainWindow?.webContents as WebContents & {
        getLastWebPreferences(): {
          contextIsolation?: boolean
          sandbox?: boolean
          nodeIntegration?: boolean
        }
      }
      return webContents?.getLastWebPreferences()
    })
    expect(preferences?.contextIsolation).toBe(true)
    expect(preferences?.sandbox).toBe(true)
    expect(preferences?.nodeIntegration).toBe(false)

    const screenshotDirectory = resolve('test-results', 'electron-preview')
    await mkdir(screenshotDirectory, { recursive: true })
    await window.screenshot({
      path: resolve(screenshotDirectory, 'operational-workbench.png'),
      fullPage: true
    })
  } finally {
    await app.close()
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})