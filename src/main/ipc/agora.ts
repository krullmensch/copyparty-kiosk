import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AgoraRole,
  AgoraResetResult,
  AgoraStats,
  AgoraStatsResult,
  IpcChannels
} from '../../shared/types'
import { getAgoraHost } from './config'

// Agora dashboard service on the main kiosk (:8080), on the same host the app
// connects to for copyparty. The host is configurable at runtime (admin panel,
// ~/.agora/host) so it needs no per-network reconfiguration. Fetched from the
// main process so the renderer CSP (connect-src 'self') stays locked, matching
// how copyparty traffic is routed.
async function agoraBase(): Promise<string> {
  return `http://${await getAgoraHost()}:8080`
}
const TIMEOUT_MS = 4000

async function fetchStats(): Promise<AgoraStatsResult> {
  try {
    const res = await fetch(`${await agoraBase()}/stats`, {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, stats: (await res.json()) as AgoraStats }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// this kiosk's role, written to ~/.agora/role by the setup script (main|client).
// the admin panel gesture is only offered on the main kiosk.
async function readRole(): Promise<AgoraRole> {
  try {
    const txt = await readFile(join(homedir(), '.agora', 'role'), 'utf-8')
    return { isMain: txt.trim() === 'main' }
  } catch {
    return { isMain: false }
  }
}

async function reset(password: string): Promise<AgoraResetResult> {
  try {
    const res = await fetch(`${await agoraBase()}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (res.status === 403) return { ok: false, error: 'Falsches Passwort' }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const j = (await res.json()) as { session: number }
    return { ok: true, session: j.session }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function registerAgoraIpc(): void {
  ipcMain.handle(IpcChannels.AgoraStats, () => fetchStats())
  ipcMain.handle(IpcChannels.AgoraRole, () => readRole())
  ipcMain.handle(IpcChannels.AgoraReset, (_, password: string) => reset(password))
}
