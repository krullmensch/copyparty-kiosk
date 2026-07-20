import { BrowserWindow, ipcMain } from 'electron'
import { createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { extStats, reportTransfer } from '../agora-events'
import {
  ConnectResult,
  IpcChannels,
  ReadTextResult,
  RemoteEntry,
  RemoteListResult,
  TransferResult,
  UploadProgress
} from '../../shared/types'
import { uploadFile } from '../up2k'
import {
  cleanupTempDirs,
  expandForUpload,
  resolveCollisions,
  type ExpandItem
} from '../copy-expand'

interface CookieJar {
  [serverUrl: string]: string
}

const cookies: CookieJar = {}

// Servers the renderer has successfully reached this session. Includes anonymous
// servers, which never enter the cookie jar (no login) — so cookie presence is
// NOT a valid "is this server known" signal. The kiosk-stream:// remote proxy
// gates on this set instead.
const knownServers = new Set<string>()

function normalizeServer(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Cookie header for a live connection, or undefined when we hold no cookie for
 * this server (anonymous servers always return undefined). Used by the
 * kiosk-stream:// remote proxy to authenticate when a cookie exists.
 */
export function getCookieHeader(serverUrl: string): string | undefined {
  return cookies[normalizeServer(serverUrl)]
}

/** Whether the renderer has reached this server this session (auth or anon). */
export function isKnownServer(serverUrl: string): boolean {
  return knownServers.has(normalizeServer(serverUrl))
}

/**
 * Overwrite a remote file with `body` via WebDAV PUT (copyparty needs
 * `d`+`--daw` for this to replace rather than rename). Used for text editing and
 * metadata write-back. Returns ok/false with a message.
 */
export async function putRemoteFile(
  serverUrl: string,
  vpath: string,
  body: Uint8Array | string
): Promise<{ ok: boolean; message?: string }> {
  const server = normalizeServer(serverUrl)
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  const headers: Record<string, string> = {}
  const cookie = cookies[server]
  if (cookie) headers['Cookie'] = cookie
  try {
    const res = await fetch(`${server}${vp}`, {
      method: 'PUT',
      headers,
      body: body as BodyInit
    })
    if (res.ok) return { ok: true }
    return { ok: false, message: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'PUT failed' }
  }
}

/**
 * Fetch the first `maxBytes` of a remote file as UTF-8 text, authenticating
 * with the stored cookie. Used by the preview text handler — the renderer
 * cannot fetch kiosk-stream:// itself (custom-scheme CORS yields opaque bodies).
 */
export async function fetchRemoteText(
  serverUrl: string,
  vpath: string,
  maxBytes: number
): Promise<ReadTextResult> {
  const server = normalizeServer(serverUrl)
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  const headers = { ...(buildHeaders(server) as Record<string, string>), Range: `bytes=0-${maxBytes - 1}` }
  let res: Response
  try {
    res = await fetch(`${server}${vp}`, { headers })
  } catch (err) {
    return { text: '', truncated: false, error: err instanceof Error ? err.message : 'fetch failed' }
  }
  if (!res.ok && res.status !== 206) {
    return { text: '', truncated: false, error: `HTTP ${res.status}` }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return { text: buf.subarray(0, maxBytes).toString('utf-8'), truncated: buf.length >= maxBytes }
}

/**
 * Fetch a whole remote file as bytes (cookie-authenticated). Used by viewers
 * that must decode the full payload client-side (audio waveform, 3D models) —
 * the renderer cannot fetch kiosk-stream:// itself. Returns null on failure or
 * when the file exceeds `maxBytes`.
 */
export async function fetchRemoteBytes(
  serverUrl: string,
  vpath: string,
  maxBytes: number
): Promise<Uint8Array | null> {
  const server = normalizeServer(serverUrl)
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  let res: Response
  try {
    res = await fetch(`${server}${vp}`, { headers: buildHeaders(server) })
  } catch {
    return null
  }
  if (!res.ok) return null
  const len = Number(res.headers.get('content-length') ?? '0')
  if (len > maxBytes) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) return null
  return new Uint8Array(buf)
}

function buildHeaders(server: string): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const cookie = cookies[server]
  if (cookie) headers['Cookie'] = cookie
  return headers
}

function captureCookies(server: string, res: Response): void {
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) return
  const pairs = setCookie.split(/,\s*(?=[A-Za-z]+=)/)
  const existing = cookies[server] ? cookies[server].split('; ') : []
  const map = new Map<string, string>()
  for (const c of existing) {
    const [k, v] = c.split('=')
    if (k) map.set(k, v ?? '')
  }
  for (const raw of pairs) {
    const part = raw.split(';')[0]
    const eq = part.indexOf('=')
    if (eq < 0) continue
    map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  cookies[server] = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function connect(serverUrl: string, password?: string): Promise<ConnectResult> {
  const server = normalizeServer(serverUrl)
  if (!password) {
    // try anonymous probe
    const res = await fetch(`${server}/?ls`, { headers: buildHeaders(server) })
    if (res.ok) knownServers.add(server)
    return { ok: res.ok, status: res.status }
  }
  const body = new URLSearchParams({ cppwd: password }).toString()
  const res = await fetch(`${server}/?login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual'
  })
  captureCookies(server, res)
  // copyparty's ?login endpoint does not emit Set-Cookie when sessions are
  // disabled (--no-ses), and when sessions are on it still requires the
  // password to be present as the cppwd cookie. Inject it ourselves so
  // follow-up requests authenticate.
  const existing = cookies[server]
    ? cookies[server].split('; ').filter((c) => !c.startsWith('cppwd='))
    : []
  existing.push(`cppwd=${encodeURIComponent(password)}`)
  cookies[server] = existing.join('; ')
  // copyparty returns 200 on bad pw too, but no cookie. Verify by probing ?ls
  const probe = await fetch(`${server}/?ls`, { headers: buildHeaders(server) })
  if (!probe.ok) {
    return { ok: false, status: probe.status, message: 'login probe failed' }
  }
  try {
    const j = (await probe.json()) as { acct?: string }
    if (!j.acct || j.acct === '*') {
      delete cookies[server]
      return { ok: false, status: 401, message: 'invalid password' }
    }
    knownServers.add(server)
    return { ok: true, status: 200, acct: j.acct }
  } catch {
    knownServers.add(server)
    return { ok: true, status: 200 }
  }
}

interface CppLsRaw {
  href: string
  name?: string
  sz?: number
  ts?: number
  tags?: Record<string, unknown>
}

interface CppLsResponse {
  dirs?: CppLsRaw[]
  files?: CppLsRaw[]
  acct?: string
  perms?: string[]
  srvinf?: string
}

function nameFromHref(href: string): string {
  const stripped = href.replace(/\/$/, '')
  const last = stripped.split('/').pop() ?? stripped
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

async function list(serverUrl: string, vpath: string): Promise<RemoteListResult> {
  const server = normalizeServer(serverUrl)
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  const url = `${server}${vp}${vp.endsWith('/') ? '' : '/'}?ls`
  const res = await fetch(url, { headers: buildHeaders(server) })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  // A successful listing proves reachability; mark known so the stream proxy
  // will serve files from this server (covers anon servers after a restart
  // where the renderer lists without a fresh connect()).
  knownServers.add(server)
  const json = (await res.json()) as CppLsResponse

  const dirs: RemoteEntry[] = (json.dirs ?? []).map((d) => ({
    name: d.name ?? nameFromHref(d.href),
    href: d.href,
    size: 0,
    ts: (d.ts ?? 0) * 1000,
    isDirectory: true,
    tags: d.tags
  }))
  const files: RemoteEntry[] = (json.files ?? []).map((f) => ({
    name: f.name ?? nameFromHref(f.href),
    href: f.href,
    size: f.sz ?? 0,
    ts: (f.ts ?? 0) * 1000,
    isDirectory: false,
    tags: f.tags
  }))

  const cleanVp = vp.replace(/\/$/, '') || '/'
  const parent = cleanVp === '/' ? null : cleanVp.split('/').slice(0, -1).join('/') || '/'

  return {
    vpath: cleanVp,
    parent,
    entries: [...dirs, ...files],
    perms: json.perms ?? [],
    acct: json.acct,
    srvinf: json.srvinf
  }
}

function disconnect(serverUrl: string): void {
  const server = normalizeServer(serverUrl)
  delete cookies[server]
  knownServers.delete(server)
}

async function thumb(serverUrl: string, vpath: string): Promise<string | null> {
  const server = normalizeServer(serverUrl)
  const vp = vpath.startsWith('/') ? vpath : `/${vpath}`
  const url = `${server}${vp}?th=w`
  const headers: Record<string, string> = {}
  const cookie = cookies[server]
  if (cookie) headers['Cookie'] = cookie
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? 'image/webp'
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${ct};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** joins a base vpath with a relative subdir, avoiding double slashes. */
function joinVpath(base: string, sub: string): string {
  const b = base.replace(/\/+$/, '')
  if (!sub) return b || '/'
  return `${b}/${sub}`
}

/** fire-and-forget agora report for the files that actually uploaded. */
function reportUploaded(items: ExpandItem[], done: number): void {
  if (done <= 0) return
  const doneItems = items.slice(0, done)
  const bytes = doneItems.reduce((acc, it) => acc + it.size, 0)
  const mapped = doneItems.map((it) => ({ name: basename(it.filePath), size: it.size }))
  reportTransfer('up', done, bytes, extStats(mapped))
}

export async function upload(
  serverUrl: string,
  targetVpath: string,
  localPaths: string[],
  emit: (p: UploadProgress) => void,
  signal?: AbortSignal
): Promise<TransferResult> {
  const server = normalizeServer(serverUrl)

  // expand folders (walk) and zips (extract to temp) into a flat file list that
  // keeps each folder/zip as one intact unit; the source browse path is dropped.
  let items: ExpandItem[]
  let tempDirs: string[]
  try {
    ;({ items, tempDirs } = await expandForUpload(localPaths))
  } catch (err) {
    const msg = (err as Error).message
    emit({ kind: 'error', name: 'expand', message: msg })
    return { ok: false, done: 0, total: 0, message: msg }
  }

  // resolve top-level name collisions against the current target listing so a
  // dropped "Album" never merges into an existing "Album" (lands as "Album (2)").
  let existing = new Set<string>()
  try {
    const cur = await list(server, targetVpath)
    existing = new Set(cur.entries.map((e) => e.name))
  } catch {
    // target unreachable/empty: proceed without collision info
  }
  const renames = resolveCollisions(items, existing)

  let done = 0
  try {
    for (const it of items) {
      const sub = it.topUnit != null ? applyRename(it.subVpath, it.topUnit, renames) : it.subVpath
      try {
        if (signal?.aborted) throw new Error('Aborted')
        await uploadFile({
          server,
          targetVpath: joinVpath(targetVpath, sub),
          filePath: it.filePath,
          cookie: cookies[server],
          onProgress: emit,
          signal
        })
        done++
      } catch (err) {
        const msg = (err as Error).message
        emit({ kind: 'error', name: it.filePath, message: msg })
        reportUploaded(items, done)
        return { ok: false, done, total: items.length, message: msg }
      }
    }
    reportUploaded(items, done)
    return { ok: true, done, total: items.length }
  } finally {
    await cleanupTempDirs(tempDirs)
  }
}

/** rewrites the first path segment (the top unit) to its collision-free name. */
function applyRename(subVpath: string, topUnit: string, renames: Map<string, string>): string {
  const renamed = renames.get(topUnit)
  if (!renamed || renamed === topUnit) return subVpath
  const rest = subVpath === topUnit ? '' : subVpath.slice(topUnit.length + 1)
  return rest ? `${renamed}/${rest}` : renamed
}

async function downloadOne(
  server: string,
  sourceVpath: string,
  targetDir: string,
  name: string,
  emit?: (p: import('../../shared/types').DownloadProgress) => void
): Promise<number> {
  const url = `${server}${sourceVpath}`
  const headers: Record<string, string> = {}
  const cookie = cookies[server]
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`)
  if (!res.body) throw new Error(`download ${name}: empty body`)
  const target = join(targetDir, name)

  const total = Number(res.headers.get('content-length')) || 0
  let done = 0

  const stream = await import('node:stream').then(s => s.Readable.fromWeb(res.body as any))
  
  if (emit) {
    stream.on('data', (chunk: Buffer) => {
      done += chunk.length
      emit({ kind: 'download', name, bytesDone: done, bytesTotal: total })
    })
  }
  await pipeline(stream, createWriteStream(target))
  const s = await stat(target)
  return s.size
}

export async function download(
  serverUrl: string,
  targetDir: string,
  items: { vpath: string; name: string }[],
  emit?: (p: import('../../shared/types').DownloadProgress) => void
): Promise<TransferResult> {
  const server = normalizeServer(serverUrl)
  let done = 0
  const downloadedItems: { name: string; size: number }[] = []
  for (const item of items) {
    try {
      const size = await downloadOne(server, item.vpath, targetDir, item.name, emit)
      downloadedItems.push({ name: item.name, size })
      if (emit) emit({ kind: 'done', name: item.name })
      done++
    } catch (err) {
      reportDownloaded(downloadedItems)
      if (emit) emit({ kind: 'error', name: item.name, message: (err as Error).message })
      return { ok: false, done, total: items.length, message: (err as Error).message }
    }
  }
  reportDownloaded(downloadedItems)
  return { ok: true, done, total: items.length }
}

/** fire-and-forget agora report for the files that actually downloaded. */
function reportDownloaded(items: { name: string; size: number }[]): void {
  if (items.length <= 0) return
  const bytes = items.reduce((acc, it) => acc + it.size, 0)
  reportTransfer('down', items.length, bytes, extStats(items))
}

const SEARCH_LIMIT = 500

interface CppSrchRaw {
  rp?: string
  href?: string
  sz?: number
  ts?: number
}

async function search(
  serverUrl: string,
  query: string
): Promise<{ hits: import('../../shared/types').CppSearchHit[]; truncated: boolean }> {
  const q = query.trim()
  if (!q) return { hits: [], truncated: false }
  const server = normalizeServer(serverUrl)
  // copyparty search endpoint expects POST JSON to /?srch with {q: "name like *foo*"}
  const body = JSON.stringify({ q: `name like *${q.replace(/\*/g, '')}*` })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const cookie = cookies[server]
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(`${server}/?srch`, { method: 'POST', headers, body })
  if (!res.ok) return { hits: [], truncated: false }
  let arr: CppSrchRaw[] = []
  try {
    const j = (await res.json()) as { hits?: CppSrchRaw[] } | CppSrchRaw[]
    arr = Array.isArray(j) ? j : (j.hits ?? [])
  } catch {
    return { hits: [], truncated: false }
  }
  const truncated = arr.length > SEARCH_LIMIT
  const sliced = arr.slice(0, SEARCH_LIMIT)
  const hits = sliced.map((r) => {
    const rp = r.rp ?? r.href ?? ''
    const vpath = rp.startsWith('/') ? rp : `/${rp}`
    const name = nameFromHref(vpath)
    return {
      name,
      vpath,
      isDirectory: vpath.endsWith('/'),
      size: r.sz ?? 0,
      ts: (r.ts ?? 0) * 1000
    }
  })
  return { hits, truncated }
}

export async function deleteItems(serverUrl: string, vpaths: string[]): Promise<boolean> {
  if (vpaths.length === 0) return true
  const server = normalizeServer(serverUrl)
  try {
    const res = await fetch(`${server}/?delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildHeaders(server) },
      body: JSON.stringify(vpaths)
    })
    return res.ok
  } catch {
    return false
  }
}

export function registerCppIpc(mainWindow: BrowserWindow): void {
  const emitProgress = (p: UploadProgress): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.CppProgress, p)
    }
  }
  ipcMain.handle(
    IpcChannels.CppConnect,
    async (_, url: string, password?: string): Promise<ConnectResult> => {
      try {
        return await connect(url, password)
      } catch (err) {
        return { ok: false, status: 0, message: (err as Error).message }
      }
    }
  )
  ipcMain.handle(IpcChannels.CppList, async (_, url: string, vpath: string) => list(url, vpath))
  ipcMain.handle(IpcChannels.CppDisconnect, async (_, url: string) => {
    disconnect(url)
  })
  ipcMain.handle(IpcChannels.CppConnections, async () => Object.keys(cookies))
  ipcMain.handle(
    IpcChannels.CppDownload,
    async (_, url: string, targetDir: string, items: { vpath: string; name: string }[]) => {
      return download(url, targetDir, items, (p) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcChannels.CppDownloadProgress, p)
        }
      })
    }
  )
  ipcMain.handle(
    IpcChannels.CppUpload,
    async (_, url: string, targetVpath: string, localPaths: string[]) =>
      upload(url, targetVpath, localPaths, emitProgress)
  )
  ipcMain.handle(
    IpcChannels.CppDownload,
    async (_, url: string, targetDir: string, items: { vpath: string; name: string }[]) =>
      download(url, targetDir, items)
  )
  ipcMain.handle(IpcChannels.CppThumb, async (_, url: string, vpath: string) => thumb(url, vpath))
  ipcMain.handle(IpcChannels.CppSearch, async (_, url: string, query: string) => search(url, query))
}
