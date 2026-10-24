import { tmpdir } from 'node:os'
import { join } from 'node:path'

// PowerShell expands Windows temp aliases; owner-control tests must also stay inside LocalAppData.
export const temporaryRoot = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Temp')
  : tmpdir()
