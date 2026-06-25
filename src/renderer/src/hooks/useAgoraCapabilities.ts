import { useEffect, useState } from 'react'

const PROBE_MS = 20000

interface Capabilities {
  isMain: boolean
  trackingEnabled: boolean
}

/**
 * resolves what Agora features this kiosk should expose:
 * - isMain: from the local role file (admin panel only on the main kiosk)
 * - trackingEnabled: from the server (stats button hidden when no FritzBox
 *   password is configured). Re-probed periodically so the button appears once
 *   the main kiosk's server becomes reachable after boot.
 */
export function useAgoraCapabilities(): Capabilities {
  const [caps, setCaps] = useState<Capabilities>({ isMain: false, trackingEnabled: false })

  useEffect(() => {
    let cancelled = false

    window.api.agora.role().then((r) => {
      if (!cancelled) setCaps((c) => ({ ...c, isMain: r.isMain }))
    })

    async function probe(): Promise<void> {
      const res = await window.api.agora.stats()
      if (cancelled) return
      setCaps((c) => ({ ...c, trackingEnabled: res.ok && res.stats.enabled }))
    }
    probe()
    const id = setInterval(probe, PROBE_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return caps
}
