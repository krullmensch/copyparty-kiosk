import { ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isIPv4 } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { IpcChannels, ShareResult } from '../../shared/types'
import { extStats, reportQrShare } from '../agora-events'
import { getAgoraHost } from './config'

// Self-contained: does not import from copyparty.ts. The share POST uses its
// own auth (the dedicated `qr` account's password, ~/.agora/share.pw), not the
// browsing session's cookie jar -- browsing stays anonymous.

const SHARE_PW_FILE = join(homedir(), '.agora', 'share.pw')
const SHARE_TIMEOUT_MS = 10_000
const COPYPARTY_PORT = 3923
const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const KEY_LEN = 8

export interface ShareItem {
  vpath: string
  name: string
  size: number
  isDirectory: boolean
}

function normalizeServer(url: string): string {
  return url.replace(/\/+$/, '')
}

// 256 is not divisible by 36 -- a plain `byte % 36` would make digits 0-3
// land ~1.4x more often than digits 4-35. Reject bytes >= this threshold
// (the largest multiple of the alphabet length <= 256) and redraw instead.
const REJECTION_THRESHOLD = 256 - (256 % KEY_ALPHABET.length)

/** 8 random chars from [0-9a-z], crypto-sourced (not Math.random), unbiased via rejection sampling. */
export function generateShareKey(): string {
  let out = ''
  while (out.length < KEY_LEN) {
    const bytes = randomBytes(KEY_LEN - out.length)
    for (const b of bytes) {
      if (b >= REJECTION_THRESHOLD) continue
      out += KEY_ALPHABET[b % KEY_ALPHABET.length]
      if (out.length === KEY_LEN) break
    }
  }
  return out
}

/** null when selectable, else a user-facing error string. */
export function validateShareItems(items: ShareItem[]): string | null {
  if (items.length === 0) return 'Keine Dateien ausgewählt'
  const dirs = items.filter((it) => it.isDirectory)
  if (dirs.length > 1) return 'Mehrere Ordner lassen sich nicht zusammen teilen'
  if (dirs.length > 0 && dirs.length !== items.length) {
    return 'Ordner und Dateien lassen sich nicht zusammen teilen'
  }
  return null
}

// App-internal vpaths are URL-encoded (built from copyparty's `?ls` href, e.g.
// `dir/My%20File.flac`) -- that form works for fetch() everywhere else. But the
// /?share JSON API takes the raw virtual path and matches it literally, so a
// %-encoded segment would point at a non-existent file. Decode per segment
// ('/' separators stay literal) before sending. Malformed escapes fall back to
// the segment unchanged instead of throwing.
function decodeVpath(vpath: string): string {
  return vpath
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
    .join('/')
}

/** copyparty /?share request body. Assumes items already passed validateShareItems. */
export function buildShareBody(
  key: string,
  items: ShareItem[]
): { k: string; vp: string[]; pw: string; exp: string; perms: string[] } {
  const vp =
    items.length === 1 && items[0].isDirectory
      ? [decodeVpath(items[0].vpath.endsWith('/') ? items[0].vpath : `${items[0].vpath}/`)]
      : items.map((it) => decodeVpath(it.vpath))
  return { k: key, vp, pw: '', exp: '60', perms: ['read', 'get'] }
}

/** 1 file -> direct download link; n files or 1 folder -> zip link. */
export function buildShareUrl(baseUrl: string, key: string, items: ShareItem[]): string {
  if (items.length === 1 && !items[0].isDirectory) {
    return `${baseUrl}/s/${key}/${encodeURIComponent(items[0].name)}?dl`
  }
  return `${baseUrl}/s/${key}/?zip`
}

/** trimmed password, or null if the file is missing/empty. Read fresh every call -- not cached. */
async function readSharePassword(): Promise<string | null> {
  try {
    const txt = (await readFile(SHARE_PW_FILE, 'utf-8')).trim()
    return txt || null
  } catch {
    return null
  }
}

/** the agora host resolved to IPv4, so the QR never encodes a .local name Android can't resolve. */
async function resolveAgoraIp(): Promise<string> {
  const host = await getAgoraHost()
  let addr = host
  if (!isIPv4(host)) {
    const res = await dnsLookup(host, { family: 4 })
    addr = res.address
  }
  
  if (addr.startsWith('127.')) {
    const interfaces = networkInterfaces()
    
    // First try: look for physical interfaces (eth, en, wl, wlan)
    let found = false
    for (const [name, nets] of Object.entries(interfaces)) {
      if (!name.match(/^(en|eth|wl|wlan)/)) continue
      for (const net of nets || []) {
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
          addr = net.address
          found = true
          break
        }
      }
      if (found) break
    }
    
    // Fallback: any non-internal IPv4 that isn't docker/veth/lo
    if (!found) {
      for (const [name, nets] of Object.entries(interfaces)) {
        if (name.startsWith('docker') || name.startsWith('veth') || name === 'lo') continue
        for (const net of nets || []) {
          if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
            addr = net.address
            found = true
            break
          }
        }
        if (found) break
      }
    }
  }

  return addr
}

async function postShare(
  server: string,
  pw: string,
  body: ReturnType<typeof buildShareBody>
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(`${server}/?share`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Cookie: `cppwd=${encodeURIComponent(pw)}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SHARE_TIMEOUT_MS)
  })
  const text = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, text }
}

export async function createShare(url: string, items: ShareItem[]): Promise<ShareResult> {
  const pw = await readSharePassword()
  if (!pw) return { ok: false, error: 'Kein QR-Passwort gesetzt (~/.agora/share.pw)' }

  const validationError = validateShareItems(items)
  if (validationError) return { ok: false, error: validationError }

  let ip: string
  try {
    ip = await resolveAgoraIp()
  } catch (err) {
    return { ok: false, error: `Agora-Host nicht auflösbar: ${(err as Error).message}` }
  }

  const server = normalizeServer(url)
  try {
    let key = generateShareKey()
    let result = await postShare(server, pw, buildShareBody(key, items))
    if (!result.ok && result.status === 400 && result.text.includes('already in use')) {
      key = generateShareKey()
      result = await postShare(server, pw, buildShareBody(key, items))
    }
    if (!result.ok) {
      return { ok: false, error: result.text || `HTTP ${result.status}` }
    }

    const base = `http://${ip}:${COPYPARTY_PORT}`
    const files = items.length
    const bytes = items.reduce((acc, it) => acc + it.size, 0)
    // RemoteEntry reports size: 0 for directories (no recursive size available),
    // so `bytes` silently undercounts whenever a folder is in the selection.
    // Flag that instead of pretending the number is exact.
    const bytesKnown = !items.some((it) => it.isDirectory)
    const expiresAt = Date.now() + 60 * 60 * 1000

    reportQrShare(files, bytes, extStats(items.map((it) => ({ name: it.name, size: it.size }))))

    return {
      ok: true,
      url: buildShareUrl(base, key, items),
      key,
      expiresAt,
      files,
      bytes,
      bytesKnown
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function registerShareIpc(): void {
  ipcMain.handle(IpcChannels.CppShare, async (_, url: string, items: ShareItem[]) =>
    createShare(url, items)
  )
}
