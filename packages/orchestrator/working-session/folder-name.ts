import { createHash } from 'node:crypto'

const reservedDeviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const maximumNameLength = 120

/** `<Opportunity> - <Milestone>` as one Windows-safe folder name. Untrusted CRM text never reaches the file system unsanitized. */
export function workingSessionFolderName(opportunityName: string, milestoneName: string): string {
  const raw = `${opportunityName} - ${milestoneName}`
  let name = raw.normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (!name) name = 'Working session'
  if (name.length > maximumNameLength) {
    const suffix = createHash('sha256').update(raw).digest('hex').slice(0, 8)
    name = `${name.slice(0, maximumNameLength - 9).trimEnd().replace(/[. ]+$/, '')}-${suffix}`
  }
  if (reservedDeviceName.test(name.split('.')[0] ?? '')) name = `_${name}`
  return name
}

/** Lower-case ASCII file slug used for generated files. */
export function fileSlug(value: string, maximumLength = 60): string {
  const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, maximumLength).replace(/-+$/, '')
  return slug || 'item'
}
