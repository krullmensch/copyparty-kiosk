import { hostname } from 'node:os'
import { AgoraEvent } from '../shared/types'
import { getAgoraHost } from './ipc/config'

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

export interface ExtStats {
  count: number
  bytes: number
}

/** counts and bytes of file extensions across items; files without one are skipped. */
export function extStats(items: { name: string; size: number }[]): Record<string, ExtStats> {
  const out: Record<string, ExtStats> = {}
  for (const it of items) {
    const ext = extOf(it.name)
    if (!ext) continue
    if (!out[ext]) out[ext] = { count: 0, bytes: 0 }
    out[ext].count++
    out[ext].bytes += it.size
  }
  return out
}

/** POSTs the event, stamping this kiosk's hostname. Never rejects. */
function post(event: AgoraEvent): void {
  void (async () => {
    const base = `http://${await getAgoraHost()}:8080`
    return fetch(`${base}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  })().catch(() => {
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
  bytes: number,
  exts: Record<string, ExtStats>
): void {
  post({ kind: 'transfer', kiosk: hostname(), direction, files, bytes, exts })
}

export function reportQrShare(files: number, bytes: number, exts: Record<string, ExtStats>): void {
  post({ kind: 'qr_share', kiosk: hostname(), files, bytes, exts })
}
