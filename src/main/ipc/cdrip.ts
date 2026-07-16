import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { CdRipProgress, CdRipResult, IpcChannels } from '../../shared/types'
import { upload } from './copyparty'

// Rips an audio CD track-by-track and uploads the result straight to Agora.
// cdparanoia does the actual read (jitter/error correction against a scratched
// or worn disc -- ordinary CD drivers don't bother), ffmpeg encodes each WAV to
// FLAC (lossless, small enough to sneakernet), and cd-info optionally reads
// CD-TEXT off the disc for real track names. All three must be installed on
// the kiosk (offline; not bundled, see kiosk-infra memory) -- cd-info is
// optional, its absence just means generic "trackNN" names.

const execFileAsync = promisify(execFile)

/** True if the cdparanoia binary is on PATH. */
export function isRipAvailable(): Promise<boolean> {
  return new Promise((res) => {
    execFile('cdparanoia', ['--version'], (err) => res(!err))
  })
}

/** Only allow /dev/sr* (Linux optical nodes) as rip sources. */
export function isOpticalDevice(device: string): boolean {
  return /^\/dev\/sr\d+$/.test(device)
}

/** Filesystem/vpath-safe stem derived from the disc's CD-TEXT album title. */
export function sanitizeName(label: string): string {
  const s = label
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return s || 'Audio-CD'
}

/**
 * Parse `cdparanoia -Q`'s track table. Each audio track is a numbered row like
 * "  1.    12345 [02:44.45]     0 [00:00.00]    ...  no   no  2" -- count the
 * highest track number seen. Exported for testability.
 */
export function parseTrackCount(stderr: string): number {
  const matches = [...stderr.matchAll(/^\s*(\d+)\.\s+\d+/gm)]
  if (matches.length === 0) return 0
  return Math.max(...matches.map((m) => parseInt(m[1], 10)))
}

/**
 * Tolerant parser for `cd-info`'s CD-TEXT dump. cd-info prints an unrelated
 * "TRACK n ISRC:" list *before* the CD-TEXT, so key strictly off the labelled
 * "CD-TEXT for Disc:" (album) and "CD-TEXT for Track N:" (per-track) sections
 * instead of the first "track N" seen. Each section's indented body carries a
 * "TITLE:" line. Never throws -- no CD-TEXT (or an unexpected layout) just
 * yields an empty track map. Exported for testability.
 */
export function parseCdText(stdout: string): {
  album?: string
  artist?: string
  tracks: Record<number, string>
} {
  const tracks: Record<number, string> = {}
  try {
    if (!/CD-TEXT/i.test(stdout)) return { tracks }

    // A section runs until the next "CD-TEXT for ..." header or a non-indented
    // line (its indented TITLE/PERFORMER body ends there).
    const discMatch = /CD-TEXT for Disc:\s*([\s\S]*?)(?=CD-TEXT for |\n\S|$)/i.exec(stdout)
    let album: string | undefined
    let artist: string | undefined
    if (discMatch) {
      const t = /TITLE:\s*(.+)/i.exec(discMatch[1])
      if (t) album = t[1].trim()
      const p = /PERFORMER:\s*(.+)/i.exec(discMatch[1])
      if (p) artist = p[1].trim()
    }

    const sectionRe = /CD-TEXT for Track\s*(\d+):\s*([\s\S]*?)(?=CD-TEXT for |\n\S|$)/gi
    let m: RegExpExecArray | null
    while ((m = sectionRe.exec(stdout)) !== null) {
      const track = parseInt(m[1], 10)
      const titleMatch = /TITLE:\s*(.+)/i.exec(m[2])
      if (titleMatch) tracks[track] = titleMatch[1].trim()
    }
    return { album, artist, tracks }
  } catch {
    return { tracks: {} }
  }
}

/**
 * `cdparanoia -Q` prints the TOC to stderr. Some builds exit non-zero even on a
 * successful query, so on error we still parse the captured stdout/stderr the
 * error object carries before giving up (0 = no disc/no drive/no tracks).
 */
async function readToc(device: string): Promise<number> {
  try {
    const { stdout, stderr } = await execFileAsync('cdparanoia', ['-Q', '-d', device])
    return parseTrackCount(stdout + stderr)
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return parseTrackCount((e.stdout ?? '') + (e.stderr ?? ''))
  }
}

/** cd-info is optional -- missing binary or a disc without CD-TEXT both just yield generic names. */
async function readCdText(
  device: string
): Promise<{ album?: string; artist?: string; tracks: Record<number, string> }> {
  try {
    const { stdout } = await execFileAsync('cd-info', [
      '--no-device-info',
      '--no-disc-mode',
      device
    ])
    return parseCdText(stdout)
  } catch {
    return { tracks: {} }
  }
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function ripTrack(
  device: string,
  tmpDir: string,
  n: number,
  trackCount: number,
  title: string | undefined,
  album: string | undefined,
  artist: string | undefined,
  emit: (p: CdRipProgress) => void
): Promise<{ ok: boolean; message?: string; file?: string }> {
  return new Promise((resolvePromise) => {
    const nn = String(n).padStart(2, '0')
    const wavPath = join(tmpDir, `track${nn}.wav`)
    // cdparanoia's progress meter is a per-sector smiley display, not a plain
    // percentage, so there's no reliable intra-track signal to parse. Drive the
    // bar off overall track completion instead (n of trackCount) -- it advances
    // once per track rather than sitting at 0% for a whole track.
    const percent = Math.round((n / trackCount) * 100)
    emit({ kind: 'rip', track: n, total: trackCount, percent })

    const child = spawn('cdparanoia', ['-d', device, String(n), wavPath])
    let stderrTail = ''

    const onData = (buf: Buffer): void => {
      stderrTail = (stderrTail + buf.toString()).slice(-2000)
    }
    child.stderr.on('data', onData)
    child.stdout.on('data', onData)

    child.on('error', (err) => {
      emit({ kind: 'error', message: err.message })
      resolvePromise({ ok: false, message: err.message })
    })
    child.on('close', (code) => {
      if (code !== 0 || !existsSync(wavPath)) {
        const msg = stderrTail.split('\n').filter(Boolean).pop() ?? `cdparanoia exit ${code}`
        emit({ kind: 'error', message: msg })
        resolvePromise({ ok: false, message: msg })
        return
      }

      emit({ kind: 'encode', track: n, total: trackCount })
      const flacName = title ? `${nn} - ${sanitizeName(title)}.flac` : `track${nn}.flac`
      const flacPath = join(tmpDir, flacName)
      const metaArgs: string[] = ['-metadata', `track=${n}/${trackCount}`]
      if (title) metaArgs.push('-metadata', `title=${title}`)
      if (album) metaArgs.push('-metadata', `album=${album}`)
      if (artist) metaArgs.push('-metadata', `artist=${artist}`)
      const enc = spawn('ffmpeg', [
        '-y',
        '-i',
        wavPath,
        '-c:a',
        'flac',
        ...metaArgs,
        flacPath
      ])
      let encStderrTail = ''
      enc.stderr.on('data', (buf: Buffer) => {
        encStderrTail = (encStderrTail + buf.toString()).slice(-2000)
      })
      enc.on('error', (err) => {
        emit({ kind: 'error', message: err.message })
        resolvePromise({ ok: false, message: err.message })
      })
      enc.on('close', (encCode) => {
        if (encCode === 0 && existsSync(flacPath)) {
          resolvePromise({ ok: true, file: flacPath })
          return
        }
        const msg = encStderrTail.split('\n').filter(Boolean).pop() ?? `ffmpeg exit ${encCode}`
        emit({ kind: 'error', message: msg })
        resolvePromise({ ok: false, message: msg })
      })
    })
  })
}

async function rip(
  device: string,
  tmpDir: string,
  trackCount: number,
  cdText: { album?: string; artist?: string; tracks: Record<number, string> },
  emit: (p: CdRipProgress) => void
): Promise<{ ok: boolean; message?: string; files: string[] }> {
  if (!isOpticalDevice(device)) {
    return { ok: false, message: 'kein optisches Laufwerk', files: [] }
  }

  const files: string[] = []
  for (let n = 1; n <= trackCount; n++) {
    const result = await ripTrack(
      device,
      tmpDir,
      n,
      trackCount,
      cdText.tracks[n],
      cdText.album,
      cdText.artist,
      emit
    )
    if (!result.ok || !result.file) return { ok: false, message: result.message, files }
    files.push(result.file)
  }
  return { ok: true, files }
}

async function ripAndUpload(
  device: string,
  server: string,
  emit: (p: CdRipProgress) => void
): Promise<CdRipResult> {
  emit({ kind: 'scan' })
  const tmp = await fs.mkdtemp(join(tmpdir(), 'agora-cdrip-'))
  try {
    const trackCount = await readToc(device)
    if (trackCount <= 0) {
      const msg = 'Keine Audio-Tracks gefunden'
      emit({ kind: 'error', message: msg })
      return { ok: false, message: msg }
    }

    const cdText = await readCdText(device)
    const stem = cdText.album ? sanitizeName(cdText.album) : `Audio-CD-${timestamp()}`

    const ripResult = await rip(device, tmp, trackCount, cdText, emit)
    if (!ripResult.ok) return { ok: false, message: ripResult.message }

    emit({ kind: 'upload', percent: 0 })
    const uploadResult = await upload(server, `/${stem}`, ripResult.files, (p) => {
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

export function registerCdRipIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannels.CdRipAvailable, async () => isRipAvailable())
  ipcMain.handle(
    IpcChannels.CdRipStart,
    async (_, device: string, server: string): Promise<CdRipResult> =>
      ripAndUpload(device, server, (p) => window.webContents.send(IpcChannels.CdRipProgress, p))
  )
}
