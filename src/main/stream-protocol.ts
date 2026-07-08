import { app, protocol } from 'electron'
import { createReadStream, promises as fs, type ReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { getCookieHeader, isKnownServer } from './ipc/copyparty'
import { getCurrentMountpoints } from './ipc/drives'

// Custom privileged scheme that lets the sandboxed renderer stream large media
// (local files, remote copyparty files, converted previews) directly into
// <video>/<audio>/<img> without base64-inlining or leaving the app layer.
//
// Routes:
//   kiosk-stream://local/<base64url(absPath)>
//   kiosk-stream://remote/<base64url(serverUrl)>/<base64url(vpath)>
//   kiosk-stream://converted/<cacheKey>

const SCHEME = 'kiosk-stream'

// -- MIME -------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
}

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

// -- Range parsing ----------------------------------------------------------

/**
 * Parse a single-range HTTP `Range` header for a file of `fileSize` bytes.
 *
 * Returns an inclusive `{ start, end }` (both valid indices) or `null`.
 *
 * `null` is returned for: no header, malformed syntax, multi-range requests,
 * and unsatisfiable ranges (start beyond EOF). Callers treat `null` as "serve
 * the full file with status 200" — a lenient fallback rather than emitting 416.
 * Open-ended (`bytes=500-`) and suffix (`bytes=-500`) forms are supported and
 * clamped to the file bounds.
 */
export function parseRangeHeader(
  header: string | null,
  fileSize: number
): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // suffix range: last N bytes
    const suffix = parseInt(rawEnd, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  } else {
    start = parseInt(rawStart, 10)
    end = rawEnd === '' ? fileSize - 1 : parseInt(rawEnd, 10)
  }

  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (start > end) return null
  if (start >= fileSize) return null // unsatisfiable → full-content fallback
  if (end >= fileSize) end = fileSize - 1
  return { start, end }
}

// -- Helpers ----------------------------------------------------------------

function decodeB64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

function toWebStream(stream: ReadStream): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

/** True if `resolved` (already path.resolve'd) sits at or under any root. */
function isUnder(resolved: string, roots: string[]): boolean {
  for (const r of roots) {
    if (!r) continue
    const base = resolve(r)
    if (resolved === base) return true
    const prefix = base.endsWith(sep) ? base : base + sep
    if (resolved.startsWith(prefix)) return true
  }
  return false
}

/** Build a full/partial file Response, honoring the incoming Range header. */
function streamFile(absPath: string, size: number, rangeHeader: string | null): Response {
  const ct = mimeFor(absPath)
  const range = parseRangeHeader(rangeHeader, size)
  if (range) {
    const { start, end } = range
    return new Response(toWebStream(createReadStream(absPath, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': ct,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }
  return new Response(toWebStream(createReadStream(absPath)), {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes'
    }
  })
}

// -- Preview cache ----------------------------------------------------------

let previewCacheDir: string | null = null

/** Directory where the preview converter drops transcoded files. */
export function getPreviewCacheDir(): string {
  if (!previewCacheDir) {
    // sibling of thumb-cache (see thumb-cache.ts) under Electron's userData.
    previewCacheDir = join(app.getPath('userData'), 'preview-cache')
  }
  return previewCacheDir
}

// -- Route handlers ---------------------------------------------------------

async function handleLocal(encodedPath: string, req: Request): Promise<Response> {
  if (!encodedPath) return new Response('missing path', { status: 400 })
  let absPath: string
  try {
    absPath = decodeB64Url(encodedPath)
  } catch {
    return new Response('bad path', { status: 400 })
  }
  const resolved = resolve(absPath)
  // Security: only serve from the user's home or a currently-mounted drive.
  // path.resolve collapses `..`, so traversal out of these roots fails below.
  const roots = [homedir(), ...getCurrentMountpoints()]
  if (!isUnder(resolved, roots)) {
    return new Response('forbidden', { status: 403 })
  }

  let size: number
  try {
    const st = await fs.stat(resolved)
    if (!st.isFile()) return new Response('not a file', { status: 404 })
    size = st.size
  } catch {
    return new Response('not found', { status: 404 })
  }
  return streamFile(resolved, size, req.headers.get('range'))
}

async function handleRemote(
  encServer: string,
  encVpath: string,
  req: Request
): Promise<Response> {
  if (!encServer || !encVpath) return new Response('missing url', { status: 400 })
  let serverUrl: string
  let vpath: string
  try {
    serverUrl = decodeB64Url(encServer)
    vpath = decodeB64Url(encVpath)
  } catch {
    return new Response('bad url', { status: 400 })
  }

  // Only proxy to servers the renderer has reached this session. Anonymous
  // servers hold no cookie, so gate on the known-server set, not cookie
  // presence. Cookie (if any) is attached for authenticated servers.
  if (!isKnownServer(serverUrl)) {
    return new Response('unknown server', { status: 502 })
  }
  const cookie = getCookieHeader(serverUrl)

  const server = serverUrl.replace(/\/+$/, '')
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  const headers: Record<string, string> = {}
  if (cookie) headers['Cookie'] = cookie
  const range = req.headers.get('range')
  if (range) headers['Range'] = range

  let upstream: Response
  try {
    upstream = await fetch(`${server}${vp}`, { headers })
  } catch {
    return new Response('upstream failed', { status: 502 })
  }

  const out = new Headers()
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

async function handleConverted(cacheKey: string, req: Request): Promise<Response> {
  if (!cacheKey) return new Response('missing key', { status: 400 })
  let key: string
  try {
    key = decodeURIComponent(cacheKey)
  } catch {
    key = cacheKey
  }
  const dir = resolve(getPreviewCacheDir())
  const resolved = resolve(dir, key)
  // Security: the resolved path must stay strictly inside the cache dir.
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  if (!resolved.startsWith(prefix)) {
    return new Response('forbidden', { status: 403 })
  }

  let size: number
  try {
    const st = await fs.stat(resolved)
    if (!st.isFile()) return new Response('not a file', { status: 404 })
    size = st.size
  } catch {
    return new Response('not found', { status: 404 })
  }
  return streamFile(resolved, size, req.headers.get('range'))
}

// -- Dispatch + registration ------------------------------------------------

async function handler(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('bad request', { status: 400 })
  }
  const route = url.hostname
  const segments = url.pathname.replace(/^\/+/, '').split('/')
  try {
    if (route === 'local') return await handleLocal(segments[0] ?? '', request)
    if (route === 'remote') return await handleRemote(segments[0] ?? '', segments[1] ?? '', request)
    if (route === 'converted') return await handleConverted(segments[0] ?? '', request)
    return new Response('unknown route', { status: 404 })
  } catch (err) {
    console.error('[stream-protocol]', route, (err as Error).message)
    return new Response('internal error', { status: 500 })
  }
}

/**
 * Register the privileged scheme. MUST run before `app.whenReady()`
 * (i.e. at module top-level in main/index.ts).
 */
export function registerStreamProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

/** Install the request handler. Call inside `app.whenReady()`. */
export function registerStreamProtocolHandler(): void {
  protocol.handle(SCHEME, handler)
}
