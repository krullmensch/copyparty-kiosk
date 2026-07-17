import { useEffect, useSyncExternalStore } from 'react'

// Global ref-count of reasons the screensaver must stay hidden (open media
// preview, visible QR share, …). Kept as a module singleton so any component,
// however deep, can register suppression without threading props/context.
let count = 0
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

/** Register one suppression reason. Returns a release fn (call on cleanup). */
export function acquireSuppress(): () => void {
  count++
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    count--
    emit()
  }
}

/** true while at least one component is suppressing the screensaver. */
export function useScreensaverSuppressed(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => count > 0
  )
}

/** Suppress the screensaver while `active` is true (e.g. a dialog is open). */
export function useSuppressScreensaver(active: boolean): void {
  useEffect(() => {
    if (!active) return
    return acquireSuppress()
  }, [active])
}
