import { ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { reverse } from 'node:dns/promises'
import { createHash, timingSafeEqual } from 'node:crypto'
import { AgoraHostCandidate, IpcChannels } from '../../shared/types'

// The Agora host (hostname or IP) that this kiosk connects to for copyparty
// (:3923) and the dashboard (:8080). Persisted next to the role file so it
// survives restarts and can be changed at runtime from the admin panel --
// no rebuild, no hardcoded address, portable across networks.
const AGORA_DIR = join(homedir(), '.agora')
const HOST_FILE = join(AGORA_DIR, 'host')
// Admin-password hash (hex sha256) gating host changes -- the SAME file and
// hash the agora-dashboard reads for /reset (agora-dashboard/server.py,
// ADMIN_HASH), so it's one password for both, not two to keep in sync.
// Verified locally (not by calling the dashboard) so a client can still be
// re-pointed while it can't reach the server. Set once per kiosk, e.g.
//   printf '%s' 'MYPW' | sha256sum | cut -d' ' -f1 > ~/.agora/admin.hash
const ADMIN_PW_FILE = join(AGORA_DIR, 'admin.hash')
const DEFAULT_HOST = 'kiosk2.local'
const COPYPARTY_PORT = 3923

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * Verify an admin password against the local hash. Fail-closed: an unset or
 * unreadable hash file rejects every password, so the host can't be changed
 * until an admin password is configured.
 */
async function verifyAdminPassword(password: string): Promise<boolean> {
  let stored: string
  try {
    stored = (await readFile(ADMIN_PW_FILE, 'utf-8')).trim().toLowerCase()
  } catch {
    return false
  }
  if (stored.length !== 64) return false
  const a = Buffer.from(sha256Hex(password), 'hex')
  const b = Buffer.from(stored, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function adminPasswordSet(): Promise<boolean> {
  try {
    return (await readFile(ADMIN_PW_FILE, 'utf-8')).trim().length === 64
  } catch {
    return false
  }
}

/** Bare host from user input: strip any scheme, port, path, and whitespace. */
export function sanitizeHost(input: string): string {
  let s = input.trim()
  s = s.replace(/^\w+:\/\//, '') // scheme
  s = s.replace(/[/?#].*$/, '') // path/query/fragment
  s = s.replace(/:\d+$/, '') // :port
  return s.trim()
}

export async function getAgoraHost(): Promise<string> {
  try {
    const txt = (await readFile(HOST_FILE, 'utf-8')).trim()
    return txt || DEFAULT_HOST
  } catch {
    return DEFAULT_HOST
  }
}

async function setAgoraHost(
  input: string,
  password: string
): Promise<{ ok: boolean; host: string; error?: string }> {
  const current = await getAgoraHost()
  if (!(await adminPasswordSet())) {
    return { ok: false, host: current, error: 'Kein Admin-Passwort gesetzt (~/.agora/admin-pw)' }
  }
  if (!(await verifyAdminPassword(password))) {
    return { ok: false, host: current, error: 'Falsches Passwort' }
  }
  const host = sanitizeHost(input)
  if (!host) return { ok: false, host: current, error: 'Leerer Host' }
  try {
    await mkdir(AGORA_DIR, { recursive: true })
    await writeFile(HOST_FILE, `${host}\n`, 'utf-8')
    return { ok: true, host }
  } catch (err) {
    return { ok: false, host: current, error: (err as Error).message }
  }
}

/** /24 base (first three octets) of this kiosk's primary LAN address, or null. */
function localSubnetBase(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        const parts = a.address.split('.')
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}`
      }
    }
  }
  return null
}

/** True if a TCP connection to host:port opens within timeoutMs. */
function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port })
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}

/**
 * Scan this kiosk's /24 for hosts answering on the copyparty port. Returns the
 * responders with a reverse-resolved name where the network provides one.
 */
async function scanCopypartyHosts(): Promise<AgoraHostCandidate[]> {
  const base = localSubnetBase()
  if (!base) return []
  const ips = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`)
  const hits: string[] = []
  // Batch to cap concurrent sockets.
  const BATCH = 64
  for (let i = 0; i < ips.length; i += BATCH) {
    const batch = ips.slice(i, i + BATCH)
    const results = await Promise.all(batch.map((ip) => probePort(ip, COPYPARTY_PORT, 700)))
    batch.forEach((ip, j) => {
      if (results[j]) hits.push(ip)
    })
  }
  return Promise.all(
    hits.map(async (ip) => {
      let name: string | null = null
      try {
        const names = await reverse(ip)
        name = names[0] ?? null
      } catch {
        name = null
      }
      return { ip, name }
    })
  )
}

export function registerConfigIpc(): void {
  ipcMain.handle(IpcChannels.ConfigGetHost, () => getAgoraHost())
  ipcMain.handle(IpcChannels.ConfigSetHost, (_, host: string, password: string) =>
    setAgoraHost(host, password)
  )
  ipcMain.handle(IpcChannels.ConfigScanHosts, () => scanCopypartyHosts())
  ipcMain.handle(IpcChannels.ConfigAdminPwSet, () => adminPasswordSet())
}
