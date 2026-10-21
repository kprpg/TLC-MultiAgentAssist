import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { emailComposeRequestSchema, exportResponseRequestSchema } from '../../../packages/common/contracts/index.js'
import { manualMeetingTranscriptRequestSchema } from '../../../packages/common/contracts/meeting.js'
import { meetingResultSchema } from '../../../apps/teams/src/client/meeting-capture.js'
import { chooseOpportunity, openUtility, post } from './helpers.js'

const transcript = 'Seller: We have sign-off to spend 987 thousand this quarter.\nSeller: Security approval is blocked.'

test('pasted transcript evidence produces a private reviewed draft without applying any source changes', async ({ page, request }) => {
  await page.goto('/')
  const { opportunity } = await chooseOpportunity(page, request)
  await openUtility(page, 'Meetings')
  await page.getByRole('tab', { name: 'Capture', exact: true }).click()
  await page.getByRole('button', { name: 'Paste / upload', exact: true }).click()
  const before = await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })
  let previews = 0
  let commits = 0
  page.on('request', (entry) => {
    if (entry.url().endsWith('/actions/preview') || entry.url().endsWith('/meetings/preview-changes')) previews++
    if (entry.url().endsWith('/actions/commit')) commits++
  })
  await page.getByLabel('Meeting classification', { exact: true }).selectOption('internal')
  await page.getByRole('textbox', { name: 'Transcript text', exact: true }).fill(transcript)
  const acquired = page.waitForResponse((response) => response.url().endsWith('/meetings/manual'))
  await page.getByRole('button', { name: 'Extract & Review', exact: true }).click()
  const response = await acquired
  expect(response.ok()).toBeTruthy()
  const input = manualMeetingTranscriptRequestSchema.parse(response.request().postDataJSON())
  expect(input).toMatchObject({ source: 'paste', meetingType: 'internal', opportunityId: opportunity.id, content: transcript })
  const result = meetingResultSchema.parse(await response.json())
  expect(result.status).toMatchObject({ state: 'ready', attribution: 'unknown' })
  expect(result.proposals[0]?.meetingType).toBe('internal')
  await expect(page.getByRole('heading', { name: 'Proposed meeting changes', exact: true })).toBeVisible()
  await expect(page.getByText('These suggestions have not been applied.', { exact: false })).toBeVisible()
  const followUp = page.getByRole('tabpanel', { name: 'Follow-up', exact: true })
  const exports = followUp.locator('header').getByRole('group', { name: 'Response exports' })
  await expect(exports).toBeVisible({ timeout: 5000 })
  await expect(exports.getByRole('button', { name: 'Download unsent email draft' })).toBeDisabled()
  const [wordDownload, documentResponse] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse((entry) => entry.url().endsWith('/documents/export')),
    exports.getByRole('button', { name: 'Export Word', exact: true }).click()
  ])
  expect(wordDownload.suggestedFilename()).toBe('TLC-response.docx')
  const documentInput = exportResponseRequestSchema.parse(documentResponse.request().postDataJSON().document)
  expect(documentResponse.request().postDataJSON().opportunityId).toBe(opportunity.id)
  expect(documentInput.generatedAt).toBe(result.status.checkedAt)
  expect(documentInput.responseMarkdown).toContain('These suggestions have not been applied.')
  expect(documentInput.responseMarkdown).toContain(`Evidence is ${result.status.attribution}`)
  for (const proposal of result.proposals) {
    for (const slot of proposal.slots) {
      expect(documentInput.responseMarkdown).toContain(slot.label)
      expect(documentInput.responseMarkdown).toContain(slot.displayAfter)
    }
  }
  const documentPath = await wordDownload.path()
  if (!documentPath) throw new Error('The meeting Word download was not saved.')
  const documentXml = (await JSZip.loadAsync(await readFile(documentPath))).file('word/document.xml')
  expect(await documentXml?.async('string')).toContain('Meeting signals -')
  await exports.getByLabel('Email draft recipients', { exact: true }).fill('reviewer@example.com; teammate@example.com')
  const [email, emailResponse] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse((entry) => entry.url().endsWith('/documents/email')),
    exports.getByRole('button', { name: 'Download unsent email draft', exact: true }).click()
  ])
  const emailInput = emailComposeRequestSchema.parse(emailResponse.request().postDataJSON().draft)
  expect(emailInput.responseMarkdown).toBe(documentInput.responseMarkdown)
  expect(emailInput.recipients).toEqual(['reviewer@example.com', 'teammate@example.com'])
  expect(emailResponse.request().postDataJSON().opportunityId).toBe(opportunity.id)
  const emailPath = await email.path()
  if (!emailPath) throw new Error('The meeting email draft was not saved.')
  expect(await readFile(emailPath, 'utf8')).toContain('X-Unsent: 1')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(exports).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  expect(await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).toEqual(before)
  expect(previews).toBe(0)
  expect(commits).toBe(0)
  await page.getByRole('tab', { name: 'Capture', exact: true }).click()
  await page.getByRole('textbox', { name: 'Transcript text', exact: true }).fill(`${transcript}\nSeller: A different draft.`)
  await page.getByRole('tab', { name: 'Follow-up', exact: true }).click()
  await expect(page.getByText('No acquired transcript proposal is ready. Check Capture for source status.', { exact: true })).toBeVisible()
  await expect(followUp.getByRole('group', { name: 'Response exports' })).toHaveCount(0)
})

for (const format of ['vtt', 'txt'] as const) {
  test(`a ${format} transcript file feeds the same private capture and review flow`, async ({ page, request }) => {
    await page.goto('/')
    const { opportunity } = await chooseOpportunity(page, request)
    await openUtility(page, 'Meetings')
    await page.getByRole('tab', { name: 'Capture', exact: true }).click()
    await page.getByRole('button', { name: 'Paste / upload', exact: true }).click()
    const before = await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })
    const content = format === 'vtt'
      ? 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Seller>We have sign-off to spend 987 thousand this quarter.</v>'
      : transcript
    await page.getByLabel('Transcript file', { exact: true }).setInputFiles({
      name: `sanitized-meeting.${format}`, mimeType: format === 'vtt' ? 'text/vtt' : 'text/plain', buffer: Buffer.from(content)
    })
    await expect(page.getByRole('textbox', { name: 'Transcript text', exact: true })).toHaveValue(content)
    const acquired = page.waitForResponse((response) => response.url().endsWith('/meetings/manual'))
    await page.getByRole('button', { name: 'Extract & Review', exact: true }).click()
    const response = await acquired
    expect(response.ok()).toBeTruthy()
    const input = manualMeetingTranscriptRequestSchema.parse(response.request().postDataJSON())
    expect(input.source).toBe('upload')
    expect(input.format).toBe(format === 'vtt' ? 'vtt' : 'text')
    await expect(page.getByRole('heading', { name: 'Proposed meeting changes', exact: true })).toBeVisible()
    expect(await post(request, 'getOpportunityContext', { opportunityId: opportunity.id })).toEqual(before)
  })
}

test('manual capture rejects unsupported, oversized and invalid-text files without sending them to the backend', async ({ page, request }) => {
  await page.goto('/')
  await chooseOpportunity(page, request)
  await openUtility(page, 'Meetings')
  await page.getByRole('tab', { name: 'Capture', exact: true }).click()
  await page.getByRole('button', { name: 'Paste / upload', exact: true }).click()
  let sent = 0
  page.on('request', (entry) => { if (entry.url().endsWith('/meetings/manual')) sent++ })
  const file = page.getByLabel('Transcript file', { exact: true })
  await file.setInputFiles({ name: 'unsupported.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(transcript) })
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a WebVTT (.vtt)' })).toBeVisible()
  await file.setInputFiles({ name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.from('x'.repeat(512_001)) })
  await expect(page.getByRole('alert').filter({ hasText: 'must not exceed 500 KiB' })).toBeVisible()
  await file.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from([0xff, 0xfe, 0x00]) })
  await expect(page.getByRole('alert').filter({ hasText: 'could not be read as UTF-8 text' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Extract & Review', exact: true })).toBeDisabled()
  expect(sent).toBe(0)
})
