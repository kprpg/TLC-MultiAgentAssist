export class ResponseSizeError extends Error {
  constructor() { super('The response exceeded its byte budget.'); this.name = 'ResponseSizeError' }
}

export async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maximumBytes) {
      await reader.cancel()
      throw new ResponseSizeError()
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
