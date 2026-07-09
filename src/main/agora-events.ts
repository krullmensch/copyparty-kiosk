import { hostname } from 'node:os'
import { AgoraEvent } from '../shared/types'
import { AGORA_BASE } from './ipc/agora'

// Reports kiosk-side events (USB plugged, disc inserted, files transferred) to
// the agora dashboard. Strictly fire-and-forget: the dashboard is optional and
// may be offline or absent in this isolated sneakernet, so every failure is
// swallowed. Nothing here may ever reject or block a caller's hot path.

const TIMEOUT_MS = 3000
let warned = false

/** lowercase file extension without the dot, '' when the name has none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  // no dot, leading dot ("hidden"), or trailing dot => no usable extension
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** counts of file extensions across `names`; files without one are skipped. */
export function extCounts(names: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of names) {
    const ext = extOf(n)
    if (!ext) continue
    out[ext] = (out[ext] ?? 0) + 1
  }
  return out
}

/** POSTs the event, stamping this kiosk's hostname. Never rejects. */
function post(event: AgoraEvent): void {
  void fetch(`${AGORA_BASE}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }).catch(() => {
    // dashboard offline/absent is the normal case in the isolated sneakernet;
    // log at most once so a down dashboard never spams the console.
    if (!warned) {
      warned = true
      console.warn('[agora-events] dashboard unreachable, dropping events')
    }
  })
}

export function reportUsbConnected(): void {
  post({ kind: 'usb_connected', kiosk: hostname() })
}

export function reportDiscInserted(): void {
  post({ kind: 'disc_inserted', kiosk: hostname() })
}

export function reportTransfer(
  direction: 'up' | 'down',
  files: number,
  exts: Record<string, number>
): void {
  post({ kind: 'transfer', kiosk: hostname(), direction, files, exts })
}
