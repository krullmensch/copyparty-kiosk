import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { getCookieHeader, isKnownServer } from './ipc/copyparty'
import { getCurrentMountpoints } from './ipc/drives'
import { getPreviewCacheDir, mimeFor, parseRangeHeader } from './stream-protocol'

// A tiny loopback HTTP server for streaming media into <video>/<audio>/<img>.
//
// Why not the custom kiosk-stream:// protocol.handle scheme? Chromium's media
// pipeline drives large files through HTTP range requests (open a range, read a
// bit, abort on seek, open another). protocol.handle does not service those
// ranges like a real web server, so anything large enough to need a second
// range fails with "FFmpegDemuxer: data source error". A real HTTP server on
// 127.0.0.1 is treated by Chromium as an ordinary media source and range/seek
// works natively. Bound to loopback only; never exposed off-box.

let port = 0

/** Base URL the renderer prefixes onto media paths, e.g. http://127.0.0.1:53187 */
export function getMediaBase(): string {
  return `http://127.0.0.1:${port}`
}

function decodeB64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

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

/** Stream a local file with range support. Used for local/ and converted/. */
async function serveFile(absPath: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let size: number
  try {
    const st = await fs.stat(absPath)
    if (!st.isFile()) {
      res.writeHead(404).end('not a file')
      return
    }
    size = st.size
  } catch {
    res.writeHead(404).end('not found')
    return
  }

  const ct = mimeFor(absPath)
  const range = parseRangeHeader(req.headers.range ?? null, size)
  if (range) {
    const { start, end } = range
    res.writeHead(206, {
      'Content-Type': ct,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes'
    })
    createReadStream(absPath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Type': ct,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes'
    })
    createReadStream(absPath).pipe(res)
  }
}

async function serveLocal(enc: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let absPath: string
  try {
    absPath = decodeB64Url(enc)
  } catch {
    res.writeHead(400).end('bad path')
    return
  }
  const resolved = resolve(absPath)
  const roots = [homedir(), ...getCurrentMountpoints()]
  if (!isUnder(resolved, roots)) {
    res.writeHead(403).end('forbidden')
    return
  }
  await serveFile(resolved, req, res)
}

async function serveConverted(key: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cacheDir = getPreviewCacheDir()
  const resolved = resolve(cacheDir, decodeURIComponent(key))
  const prefix = cacheDir.endsWith(sep) ? cacheDir : cacheDir + sep
  if (resolved !== cacheDir && !resolved.startsWith(prefix)) {
    res.writeHead(403).end('forbidden')
    return
  }
  await serveFile(resolved, req, res)
}

async function serveRemote(
  encServer: string,
  encVpath: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let serverUrl: string
  let vpath: string
  try {
    serverUrl = decodeB64Url(encServer)
    vpath = decodeB64Url(encVpath)
  } catch {
    res.writeHead(400).end('bad url')
    return
  }
  if (!isKnownServer(serverUrl)) {
    res.writeHead(502).end('unknown server')
    return
  }
  const server = serverUrl.replace(/\/+$/, '')
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  const headers: Record<string, string> = {}
  const cookie = getCookieHeader(serverUrl)
  if (cookie) headers['Cookie'] = cookie
  if (req.headers.range) headers['Range'] = req.headers.range

  let upstream: Response
  try {
    upstream = await fetch(`${server}${vp}`, { headers })
  } catch {
    res.writeHead(502).end('upstream failed')
    return
  }

  const out: Record<string, string> = {}
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h)
    if (v) out[h] = v
  }
  res.writeHead(upstream.status, out)
  if (upstream.body) {
    Readable.fromWeb(upstream.body as never).pipe(res)
  } else {
    res.end()
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const segs = url.pathname.replace(/^\/+/, '').split('/')
    if (segs[0] === 'local' && segs[1]) return await serveLocal(segs[1], req, res)
    if (segs[0] === 'remote' && segs[1] && segs[2]) return await serveRemote(segs[1], segs[2], req, res)
    if (segs[0] === 'converted' && segs[1]) return await serveConverted(segs[1], req, res)
    res.writeHead(404).end('unknown route')
  } catch (err) {
    console.error('[media-server]', (err as Error).message)
    if (!res.headersSent) res.writeHead(500)
    res.end('internal error')
  }
}

/** Start the loopback media server. Call inside app.whenReady(). */
export function startMediaServer(): Promise<void> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => void handle(req, res))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') port = addr.port
      resolvePromise()
    })
  })
}
