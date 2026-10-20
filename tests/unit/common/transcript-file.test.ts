import { describe, expect, it, vi } from 'vitest'
import { readTranscriptFile, transcriptFileAccept } from '../../../apps/shared/transcript-file.js'
import { transcriptMaximumBytes, transcriptMaximumCharacters } from '../../../packages/common/contracts/meeting.js'

describe('browser-safe transcript file input', () => {
  it.each([
    ['meeting.vtt', 'vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Seller>Review the next steps.</v>'],
    ['meeting.TXT', 'text', 'Seller: Review the next steps.\nCustomer: We agree.']
  ])('reads %s and preserves the transcript text', async (name, format, content) => {
    expect(await readTranscriptFile(new File([content], name))).toEqual({ content, format })
    expect(transcriptFileAccept).toContain('.vtt,.txt')
  })
  it('decodes UTF-8 text without losing supplied speaker labels', async () => {
    const content = 'Ren\u00E9: Review the next steps.'
    expect((await readTranscriptFile(new File([content], 'meeting.txt'))).content).toBe(content)
  })
  it('rejects an unsupported file before reading its contents', async () => {
    const file = new File(['Do not read this binary file'], 'meeting.docx')
    const read = vi.spyOn(file, 'arrayBuffer')
    await expect(readTranscriptFile(file)).rejects.toThrow(/\.vtt.*\.txt/)
    expect(read).not.toHaveBeenCalled()
  })
  it('rejects an oversized file before allocating its contents', async () => {
    const file = new File(['x'.repeat(transcriptMaximumBytes + 1)], 'meeting.txt')
    const read = vi.spyOn(file, 'arrayBuffer')
    await expect(readTranscriptFile(file)).rejects.toThrow('500 KiB')
    expect(read).not.toHaveBeenCalled()
  })
  it.each([
    [''], ['short'], ['Binary\0data must not be accepted'], ['x'.repeat(transcriptMaximumCharacters + 1)]
  ])('rejects empty, short, binary or excessive transcript content', async (content) => {
    await expect(readTranscriptFile(new File([content], 'meeting.txt'))).rejects.toThrow()
  })
  it('reports invalid UTF-8 explicitly instead of replacing bytes silently', async () => {
    await expect(readTranscriptFile(new File([new Uint8Array([0xff, 0xfe, 0x00])], 'meeting.txt'))).rejects.toThrow('UTF-8')
  })
})
