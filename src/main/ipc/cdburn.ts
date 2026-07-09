import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { basename, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { BurnProgress, BurnResult, IpcChannels } from '../../shared/types'
import { getCurrentMountpoints } from './drives'

// Burning is done with `xorriso` (chosen 2026-07-09). One invocation builds the
// ISO 9660 + Joliet/Rock-Ridge filesystem on the fly and writes it to the disc,
// blanking a rewritable disc first if needed. xorriso must be installed on the
// kiosk (offline; not bundled). NOTE: untested end-to-end until a drive + disc
// are attached — the process wiring, arg building, and progress parsing are in
// place but real burns need verification.

/** True if the xorriso binary is on PATH. */
export function isBurnAvailable(): Promise<boolean> {
  return new Promise((res) => {
    execFile('xorriso', ['-version'], (err) => res(!err))
  })
}

/** Only allow /dev/sr* (Linux optical nodes) as burn targets. */
export function isOpticalDevice(device: string): boolean {
  return /^\/dev\/sr\d+$/.test(device)
}

function isUnderAllowedRoot(path: string): boolean {
  const roots = [homedir(), ...getCurrentMountpoints()]
  const r = resolve(path)
  return roots.some((root) => {
    if (!root) return false
    const base = resolve(root)
    if (r === base) return true
    const prefix = base.endsWith(sep) ? base : base + sep
    return r.startsWith(prefix)
  })
}

/** ISO 9660 volume id: uppercase A-Z0-9_ , max 32 chars. */
export function sanitizeLabel(label: string): string {
  const s = label
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 32)
  return s || 'AGORA'
}

/**
 * Burn the given local files/folders onto the disc in `device`. Each item lands
 * at the disc root under its basename. Emits progress via `emit`.
 */
export function burn(
  device: string,
  items: string[],
  label: string,
  emit: (p: BurnProgress) => void
): Promise<BurnResult> {
  return new Promise((resolvePromise) => {
    if (!isOpticalDevice(device)) {
      resolvePromise({ ok: false, message: 'kein optisches Laufwerk' })
      return
    }
    const safeItems = items.filter(isUnderAllowedRoot)
    if (safeItems.length === 0) {
      resolvePromise({ ok: false, message: 'keine gültigen Dateien' })
      return
    }

    const args = [
      '-outdev',
      device,
      '-blank',
      'as_needed', // clears a rewritable disc; a blank DVD-R is left as-is
      '-volid',
      sanitizeLabel(label),
      '-joliet',
      'on',
      '-rockridge',
      'on',
      '-padding',
      'included'
    ]
    for (const it of safeItems) {
      args.push('-map', it, `/${basename(it)}`)
    }
    args.push('-commit', '-eject', 'all')

    emit({ kind: 'prepare' })

    const child = spawn('xorriso', args)
    let sawBlank = false
    let stderrTail = ''

    const onData = (buf: Buffer): void => {
      const text = buf.toString()
      stderrTail = (stderrTail + text).slice(-2000)
      if (!sawBlank && /Blanking|blank/i.test(text)) {
        sawBlank = true
        emit({ kind: 'blank' })
      }
      // xorriso prints "... NN.N% done" during write
      const m = /(\d+(?:\.\d+)?)%\s*(?:done|fifo)/i.exec(text)
      if (m) emit({ kind: 'write', percent: Math.round(parseFloat(m[1])) })
    }
    child.stderr.on('data', onData)
    child.stdout.on('data', onData)

    child.on('error', (err) => {
      emit({ kind: 'error', message: err.message })
      resolvePromise({ ok: false, message: err.message })
    })
    child.on('close', (code) => {
      if (code === 0) {
        emit({ kind: 'done' })
        resolvePromise({ ok: true })
        return
      }
      const msg = stderrTail.split('\n').filter(Boolean).pop() ?? `xorriso exit ${code}`
      emit({ kind: 'error', message: msg })
      resolvePromise({ ok: false, message: msg })
    })
  })
}

export function registerCdBurnIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannels.BurnAvailable, async () => isBurnAvailable())
  ipcMain.handle(
    IpcChannels.BurnStart,
    async (_, device: string, items: string[], label: string): Promise<BurnResult> =>
      burn(device, items, label, (p) => window.webContents.send(IpcChannels.BurnProgress, p))
  )
}
