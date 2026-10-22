import { transcriptContentSchema, transcriptMaximumBytes } from '../../packages/common/contracts/meeting.js'

export const transcriptFileAccept = '.vtt,.txt,text/vtt,text/plain'

export async function readTranscriptFile(file: File): Promise<{ content: string; format: 'vtt' | 'text' }> {
  const extension = file.name.toLowerCase().split('.').at(-1)
  if (extension !== 'vtt' && extension !== 'txt') throw new Error('Choose a WebVTT (.vtt) or UTF-8 text (.txt) transcript, or paste its text.')
  if (file.size > transcriptMaximumBytes) throw new Error('Transcript files must not exceed 500 KiB.')
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
  catch (cause) { throw new Error('The transcript file could not be read as UTF-8 text. Export a .vtt/.txt file or paste the transcript text.', { cause }) }
  const parsed = transcriptContentSchema.safeParse(content)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'The transcript text is invalid.')
  return { content: parsed.data, format: extension === 'vtt' ? 'vtt' : 'text' }
}
