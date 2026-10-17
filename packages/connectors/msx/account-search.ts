import { z } from 'zod'

export const accountSearchLimit = 25

const accountRowSchema = z.object({
  accountid: z.guid(),
  name: z.string().trim().min(1),
  statecode: z.number().int().optional()
}).catchall(z.unknown())
const accountPageSchema = z.object({
  value: z.array(accountRowSchema),
  '@odata.nextLink': z.string().optional()
})
const searchEnvelopeSchema = z.object({ response: z.string() })
const searchResultsSchema = z.object({
  Error: z.null().optional(),
  Value: z.array(z.object({ Id: z.guid(), EntityName: z.literal('account') })).max(accountSearchLimit)
})
const searchStatusSchema = z.object({
  value: z.object({
    status: z.string(),
    entitystatusresults: z.array(z.object({
      entitylogicalname: z.string(),
      entitystatus: z.string(),
      searchableindexedfieldinfomap: z.record(z.string(), z.unknown())
    }))
  })
})

function searchPayload(input: unknown): unknown {
  const envelope = searchEnvelopeSchema.safeParse(input)
  if (!envelope.success) throw new Error('MSX close-name search returned an invalid response envelope.')
  try {
    return JSON.parse(envelope.data.response)
  } catch (error) {
    throw new Error('MSX close-name search returned an invalid JSON response.', { cause: error })
  }
}

export function parseAccountSearchPage(input: unknown) {
  const result = accountPageSchema.safeParse(input)
  if (!result.success) throw new Error('MSX account search returned an invalid account response.')
  return result.data
}

export function indexedAccountIds(input: unknown): string[] {
  const result = searchResultsSchema.safeParse(searchPayload(input))
  if (!result.success) throw new Error('MSX close-name search returned an invalid or unsuccessful response.')
  return [...new Set(result.data.Value.map((row) => row.Id.toLowerCase()))]
}

export function assertAccountNameIndex(input: unknown): void {
  const result = searchStatusSchema.safeParse(searchPayload(input))
  const account = result.success
    ? result.data.value.entitystatusresults.find((row) => row.entitylogicalname === 'account')
    : undefined
  if (!result.success || result.data.value.status !== 'provisioned'
    || account?.entitystatus !== 'EntitySyncComplete'
    || !Object.hasOwn(account.searchableindexedfieldinfomap, 'name')) {
    throw new Error('MSX close-name search is unavailable. Account-name indexing must be enabled and synchronized; try a shorter exact name or TPID.')
  }
}

export function fuzzyAccountName(query: string): string {
  const words = query.normalize('NFKC').replace(/['\u2019]s\b/gi, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0 || words.length > 16) {
    throw new Error('Enter an account name containing letters or numbers and no more than 16 words.')
  }
  return words.map((word) => word.length >= 4 ? `${word}~1` : word).join(' ')
}
