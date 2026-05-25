import { useEffect, useState } from 'react'
import type { ListResult } from '../../../shared/types'

interface State {
  data: ListResult | null
  error: string | null
  loading: boolean
}

export function useListing(path: string | null): State & { reload: () => void } {
  const [state, setState] = useState<State>({ data: null, error: null, loading: false })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    window.api.fs
      .list(path)
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [path, tick])

  return { ...state, reload: () => setTick((t) => t + 1) }
}
