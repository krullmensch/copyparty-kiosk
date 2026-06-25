import { useEffect, useState } from 'react'
import type { AgoraStats } from '../../../shared/types'

const POLL_MS = 5000

interface State {
  stats: AgoraStats | null
  error: string | null
  loading: boolean
}

/**
 * polls the Kiosk2 stats endpoint every 5s while `enabled` is true. The fetch
 * runs in the main process (window.api.agora.stats) so the renderer CSP stays
 * locked to connect-src 'self'.
 */
export function useAgoraStats(enabled: boolean): State {
  const [state, setState] = useState<State>({ stats: null, error: null, loading: false })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    async function load(): Promise<void> {
      const res = await window.api.agora.stats()
      if (cancelled) return
      if (res.ok) setState({ stats: res.stats, error: null, loading: false })
      else setState((s) => ({ ...s, error: res.error, loading: false }))
    }

    setState((s) => ({ ...s, loading: true }))
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled])

  return state
}
