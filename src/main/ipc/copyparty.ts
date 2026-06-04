import { BrowserWindow, ipcMain } from 'electron'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  ConnectResult,
  IpcChannels,
  RemoteEntry,
  RemoteListResult,
  TransferResult,
  UploadProgress
} from '../../shared/types'
import { uploadFile } from '../up2k'

interface CookieJar {
  [serverUrl: string]: string
}

const cookies: CookieJar = {}

function normalizeServer(url: string): string {
  return url.replace(/\/+$/, '')
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

function dbg(...args: unknown[]): void {
  try {
    require('node:fs').appendFileSync('/tmp/cpp-debug.log', new Date().toISOString() + ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n')
  } catch {}
}

async function connect(serverUrl: string, password?: string): Promise<ConnectResult> {
  const server = normalizeServer(serverUrl)
  dbg('[connect] start', { server, hasPw: !!password })
  if (!password) {
    try {
      const res = await fetch(`${server}/?ls`, { headers: buildHeaders(server) })
      dbg('[connect] anon probe', { status: res.status, ok: res.ok })
      return { ok: res.ok, status: res.status }
    } catch (e) {
      dbg('[connect] anon probe THREW', (e as Error).message)
      throw e
    }
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
  const existing = cookies[server] ? cookies[server].split('; ').filter((c) => !c.startsWith('cppwd=')) : []
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
    return { ok: true, status: 200, acct: j.acct }
  } catch {
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
  delete cookies[normalizeServer(serverUrl)]
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

async function upload(
  serverUrl: string,
  targetVpath: string,
  localPaths: string[],
  emit: (p: UploadProgress) => void
): Promise<TransferResult> {
  const server = normalizeServer(serverUrl)
  let done = 0
  for (const p of localPaths) {
    try {
      await uploadFile({
        server,
        targetVpath,
        filePath: p,
        cookie: cookies[server],
        onProgress: emit
      })
      done++
    } catch (err) {
      const msg = (err as Error).message
      emit({ kind: 'error', name: p, message: msg })
      return { ok: false, done, total: localPaths.length, message: msg }
    }
  }
  return { ok: true, done, total: localPaths.length }
}

async function downloadOne(
  server: string,
  sourceVpath: string,
  targetDir: string,
  name: string
): Promise<void> {
  const url = `${server}${sourceVpath}`
  const headers: Record<string, string> = {}
  const cookie = cookies[server]
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`)
  if (!res.body) throw new Error(`download ${name}: empty body`)
  const target = join(targetDir, name)
  await pipeline(
    Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream),
    createWriteStream(target)
  )
}

async function download(
  serverUrl: string,
  targetDir: string,
  items: { vpath: string; name: string }[]
): Promise<TransferResult> {
  const server = normalizeServer(serverUrl)
  let done = 0
  for (const item of items) {
    try {
      await downloadOne(server, item.vpath, targetDir, item.name)
      done++
    } catch (err) {
      return { ok: false, done, total: items.length, message: (err as Error).message }
    }
  }
  return { ok: true, done, total: items.length }
}

const SEARCH_LIMIT = 500

interface CppSrchRaw {
  rp?: string
  href?: string
  sz?: number
  ts?: number
}

async function search(serverUrl: string, query: string): Promise<{ hits: import('../../shared/types').CppSearchHit[]; truncated: boolean }> {
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
    IpcChannels.CppUpload,
    async (_, url: string, targetVpath: string, localPaths: string[]) =>
      upload(url, targetVpath, localPaths, emitProgress)
  )
  ipcMain.handle(
    IpcChannels.CppDownload,
    async (_, url: string, targetDir: string, items: { vpath: string; name: string }[]) =>
      download(url, targetDir, items)
  )
  ipcMain.handle(IpcChannels.CppThumb, async (_, url: string, vpath: string) =>
    thumb(url, vpath)
  )
  ipcMain.handle(IpcChannels.CppSearch, async (_, url: string, query: string) =>
    search(url, query)
  )
}
