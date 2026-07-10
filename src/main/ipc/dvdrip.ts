import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DvdRipProgress, DvdRipResult, IpcChannels } from '../../shared/types'
import { upload } from './copyparty'

// Rips the main feature off a video DVD and uploads it straight to Agora.
// HandBrakeCLI does decrypt (via system libdvdcss, dlopen'd by its bundled
// libdvdread) + transcode in one pass -- no MakeMKV, no Docker/NAS. Both
// HandBrakeCLI and libdvdcss must be installed on the kiosk (offline; not
// bundled, see kiosk-infra memory). CSS circumvention is illegal in Germany
// under §95a UrhG even for private backups -- a deliberate, documented
// exception here, not an oversight.

/** True if the HandBrakeCLI binary is on PATH. */
export function isRipAvailable(): Promise<boolean> {
  return new Promise((res) => {
    execFile('HandBrakeCLI', ['--version'], (err) => res(!err))
  })
}

/** A mounted disc counts as a video DVD if it exposes a VIDEO_TS directory. */
export function isVideoDvd(mountPath: string): boolean {
  return existsSync(join(mountPath, 'VIDEO_TS'))
}

/** Filesystem/vpath-safe stem derived from the disc label. */
export function sanitizeName(label: string): string {
  const s = label
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return s || 'DVD-Rip'
}

const UPLOAD_TARGET_VPATH = '/DVD-Rips'

function rip(
  mountPath: string,
  outFile: string,
  emit: (p: DvdRipProgress) => void
): Promise<DvdRipResult> {
  return new Promise((resolvePromise) => {
    const args = [
      '-i',
      mountPath,
      '-o',
      outFile,
      '--main-feature',
      '-e',
      'x264',
      '-q',
      '22',
      '--aencoder',
      'av_aac'
    ]

    emit({ kind: 'scan' })

    const child = spawn('HandBrakeCLI', args)
    let stderrTail = ''

    const onData = (buf: Buffer): void => {
      const text = buf.toString()
      stderrTail = (stderrTail + text).slice(-2000)
      // HandBrakeCLI prints e.g. "Encoding: task 1 of 1, 42.42 %"
      const m = /Encoding:.*?(\d+(?:\.\d+)?)\s*%/.exec(text)
      if (m) emit({ kind: 'encode', percent: Math.round(parseFloat(m[1])) })
    }
    child.stderr.on('data', onData)
    child.stdout.on('data', onData)

    child.on('error', (err) => {
      emit({ kind: 'error', message: err.message })
      resolvePromise({ ok: false, message: err.message })
    })
    child.on('close', (code) => {
      if (code === 0 && existsSync(outFile)) {
        resolvePromise({ ok: true })
        return
      }
      const msg = stderrTail.split('\n').filter(Boolean).pop() ?? `HandBrakeCLI exit ${code}`
      emit({ kind: 'error', message: msg })
      resolvePromise({ ok: false, message: msg })
    })
  })
}

async function ripAndUpload(
  mountPath: string,
  label: string,
  server: string,
  emit: (p: DvdRipProgress) => void
): Promise<DvdRipResult> {
  const tmp = await fs.mkdtemp(join(tmpdir(), 'agora-dvdrip-'))
  const outFile = join(tmp, `${sanitizeName(label)}.mp4`)
  try {
    const ripResult = await rip(mountPath, outFile, emit)
    if (!ripResult.ok) return ripResult

    emit({ kind: 'upload', percent: 0 })
    const uploadResult = await upload(server, UPLOAD_TARGET_VPATH, [outFile], (p) => {
      if (p.kind === 'upload' && p.bytesTotal > 0) {
        emit({ kind: 'upload', percent: Math.round((p.bytesDone / p.bytesTotal) * 100) })
      }
    })
    if (!uploadResult.ok) {
      const msg = uploadResult.message ?? 'Upload fehlgeschlagen'
      emit({ kind: 'error', message: msg })
      return { ok: false, message: msg }
    }
    emit({ kind: 'done' })
    return { ok: true }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

export function registerDvdRipIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannels.DvdRipAvailable, async () => isRipAvailable())
  ipcMain.handle(IpcChannels.DvdRipIsVideoDvd, async (_, mountPath: string) =>
    isVideoDvd(mountPath)
  )
  ipcMain.handle(
    IpcChannels.DvdRipStart,
    async (_, mountPath: string, label: string, server: string): Promise<DvdRipResult> =>
      ripAndUpload(mountPath, label, server, (p) =>
        window.webContents.send(IpcChannels.DvdRipProgress, p)
      )
  )
}
