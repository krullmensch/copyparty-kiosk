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

// Media is served by a loopback HTTP server (see main/media-server.ts), not the
// kiosk-stream:// protocol scheme: Chromium's media pipeline needs real HTTP
// range semantics for seeking, which protocol.handle can't provide.
const base = (): string => window.api.mediaBase

/** Baut die Media-URL für eine lokale oder remote Quelle. */
export function streamUrl(source: PreviewSource): string {
  if (source.kind === 'local') {
    return `${base()}/local/${b64url(source.path)}`
  }
  return `${base()}/remote/${b64url(source.server)}/${b64url(source.vpath)}`
}

/** Baut die URL für eine im Main konvertierte Datei (TIFF/RAW → PNG/JPG im Cache). */
export function convertedUrl(cacheKey: string): string {
  return `${base()}/converted/${encodeURIComponent(cacheKey)}`
}

/**
 * Die `<stem>.tracks.json`-Sidecar-Quelle neben einem DVD-Rip (siehe
 * main/ipc/dvdrip.ts) — Video-Extension gegen `.tracks.json` getauscht.
 */
export function sidecarSource(source: PreviewSource): PreviewSource {
  const swap = (p: string): string => p.replace(/\.[^./\\]+$/, '.tracks.json')
  return source.kind === 'local'
    ? { kind: 'local', path: swap(source.path) }
    : { kind: 'remote', server: source.server, vpath: swap(source.vpath) }
}
