/** Hands a fetched file to the browser's download UI. Browser-only; used by hosted Web and Teams. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function fetchAndSave(fetcher: typeof fetch, path: string, fileName: string): Promise<void> {
  const response = await fetcher(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(response.status === 404 ? 'The download has expired. Prepare the working session again.' : `The download failed (HTTP ${response.status}).`)
  saveBlob(await response.blob(), fileName)
}
