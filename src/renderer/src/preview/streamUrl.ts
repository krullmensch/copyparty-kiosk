import type { PreviewSource } from '../../../shared/types'

/**
 * url-safe base64 ohne padding, UTF-8 — kompatibel zu Node `Buffer.from(s, 'base64url')`.
 * Main dekodiert die Segmente exakt so (siehe main/stream-protocol.ts decodeB64Url).
 */
function b64url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Baut die kiosk-stream://-URL für eine lokale oder remote Quelle. */
export function streamUrl(source: PreviewSource): string {
  if (source.kind === 'local') {
    return `kiosk-stream://local/${b64url(source.path)}`
  }
  return `kiosk-stream://remote/${b64url(source.server)}/${b64url(source.vpath)}`
}

/** Baut die URL für eine im Main konvertierte Datei (TIFF/RAW → PNG/JPG im Cache). */
export function convertedUrl(cacheKey: string): string {
  return `kiosk-stream://converted/${encodeURIComponent(cacheKey)}`
}
