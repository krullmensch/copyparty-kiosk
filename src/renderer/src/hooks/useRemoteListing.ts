import { useEffect, useState } from 'react'
import type { RemoteListResult } from '../../../shared/types'

interface State {
  data: RemoteListResult | null
  error: string | null
  loading: boolean
}

export function useRemoteListing(
  server: string | null,
  vpath: string | null
): State & { reload: () => void } {
  const [state, setState] = useState<State>({ data: null, error: null, loading: false })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!server || !vpath) {
      setState({ data: null, error: null, loading: false })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    window.api.cpp
      .list(server, vpath)
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [server, vpath, tick])

  return { ...state, reload: () => setTick((t) => t + 1) }
}
