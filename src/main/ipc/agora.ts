import { ipcMain } from 'electron'
import { AgoraStats, AgoraStatsResult, IpcChannels } from '../../shared/types'

// Agora dashboard service on Kiosk2. Fetched from the main process so the
// renderer's CSP (connect-src 'self') stays locked, matching how copyparty
// traffic is routed. Swap to http://kiosk2.local:8080 if mDNS is reliable.
const AGORA_BASE = 'http://192.168.178.61:8080'
const TIMEOUT_MS = 4000

async function fetchStats(): Promise<AgoraStatsResult> {
  try {
    const res = await fetch(`${AGORA_BASE}/stats`, {
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, stats: (await res.json()) as AgoraStats }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function registerAgoraIpc(): void {
  ipcMain.handle(IpcChannels.AgoraStats, () => fetchStats())
}
