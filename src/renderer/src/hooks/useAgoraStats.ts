import { useEffect, useState } from 'react'

// Agora dashboard service lives on Kiosk2. Use the IP for reliability; swap to
// http://kiosk2.local:8080 if mDNS is dependable on the deployed net.
const AGORA_BASE = 'http://192.168.178.61:8080'
const POLL_MS = 5000

export interface AgoraStats {
  session: { id: number; started_at: number; uptime_s: number } | null
  live: number
  ever: number
  peak_live: number
  wlan_bytes: number | null
  updated_at: number | null
  stale_s: number | null
  history: { ts: number; live: number }[]
}

interface State {
  stats: AgoraStats | null
  error: string | null
  loading: boolean
}

/** polls the Kiosk2 stats endpoint every 5s while `enabled` is true. */
export function useAgoraStats(enabled: boolean): State {
  const [state, setState] = useState<State>({ stats: null, error: null, loading: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const ctrl = new AbortController()

    async function load(): Promise<void> {
      try {
        const res = await fetch(`${AGORA_BASE}/stats`, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const stats = (await res.json()) as AgoraStats
        if (!cancelled) setState({ stats, error: null, loading: false })
      } catch (err) {
        if (cancelled || (err as Error).name === 'AbortError') return
        setState((s) => ({ ...s, error: (err as Error).message, loading: false }))
      }
    }

    setState((s) => ({ ...s, loading: true }))
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      ctrl.abort()
      clearInterval(id)
    }
  }, [enabled])

  return state
}
