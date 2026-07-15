import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { DvdRipProgress, DvdRipResult, DvdTracks, IpcChannels } from '../../shared/types'
import { upload } from './copyparty'

// Rips the main feature off a video DVD and uploads it straight to Agora.
// HandBrakeCLI does decrypt (via system libdvdcss, dlopen'd by its bundled
// libdvdread) + transcode in one pass -- no MakeMKV, no Docker/NAS. Both
// HandBrakeCLI and libdvdcss must be installed on the kiosk (offline; not
// bundled, see kiosk-infra memory). CSS circumvention is illegal in Germany
// under §95a UrhG even for private backups -- a deliberate, documented
// exception here, not an oversight.

const execFileAsync = promisify(execFile)

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

// Rips land at the Agora root so they sit alongside everything else, not
// buried in a subfolder.
const UPLOAD_TARGET_VPATH = '/'

interface HbScanTitle {
  Index?: number
  AudioList?: { LanguageCode?: string }[]
  SubtitleList?: { LanguageCode?: string }[]
}
interface HbScan {
  MainFeature?: number
  TitleList?: HbScanTitle[]
}

/** Extract the balanced `{...}` object that follows HandBrake's "JSON Title Set:" banner. */
function extractTitleSetJson(stdout: string): string | null {
  const marker = stdout.indexOf('JSON Title Set:')
  const from = marker === -1 ? 0 : marker
  const start = stdout.indexOf('{', from)
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < stdout.length; i++) {
    const c = stdout[i]
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return stdout.slice(start, i + 1)
  }
  return null
}

/**
 * Parse a HandBrakeCLI `--json` scan into the main feature's audio + subtitle
 * language codes (iso639-2, deduped, order preserved). Exported for testability.
 */
export function parseScanJson(stdout: string): DvdTracks {
  const empty: DvdTracks = { audio: [], subtitles: [] }
  const json = extractTitleSetJson(stdout)
  if (!json) return empty
  let scan: HbScan
  try {
    scan = JSON.parse(json) as HbScan
  } catch {
    return empty
  }
  const titles = scan.TitleList ?? []
  const main = titles.find((t) => t.Index === scan.MainFeature) ?? titles[0]
  if (!main) return empty
  const langs = (list: { LanguageCode?: string }[] | undefined): string[] => {
    const out: string[] = []
    for (const e of list ?? []) {
      const code = e.LanguageCode
      if (code && !out.includes(code)) out.push(code)
    }
    return out
  }
  return { audio: langs(main.AudioList), subtitles: langs(main.SubtitleList) }
}

/** Scan a mounted video DVD for its main feature's audio + subtitle languages. */
async function scanTracks(mountPath: string): Promise<DvdTracks> {
  try {
    // HandBrake prints its log (incl. the "JSON Title Set:" banner) to stderr;
    // parse both streams. Bump maxBuffer well past the default 1 MB.
    const { stdout, stderr } = await execFileAsync(
      'HandBrakeCLI',
      ['-i', mountPath, '--main-feature', '--scan', '--json'],
      { maxBuffer: 32 * 1024 * 1024 }
    )
    return parseScanJson(stdout + stderr)
  } catch {
    return { audio: [], subtitles: [] }
  }
}

function rip(
  mountPath: string,
  outFile: string,
  emit: (p: DvdRipProgress) => void
): Promise<DvdRipResult> {
  return new Promise((resolvePromise) => {
    // MP4 container so the rip plays natively in the kiosk's Chromium <video>
    // (MKV does not). Every audio language is kept and transcoded to AAC (Chromium
    // can't decode the DVD's native AC3). DVD subtitles are VOBSUB bitmaps that
    // MP4 can't carry and no browser player renders -- they're not embedded; the
    // available subtitle languages are recorded in a sidecar (see scanTracks) so
    // the player can surface them as an info badge.
    const args = [
      '-i',
      mountPath,
      '-o',
      outFile,
      '--main-feature',
      '-f',
      'av_mp4',
      '-e',
      'x264',
      '-q',
      '22',
      '--all-audio',
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
  const stem = sanitizeName(label)
  const outFile = join(tmp, `${stem}.mp4`)
  const sidecarFile = join(tmp, `${stem}.tracks.json`)
  try {
    // Scan first so the sidecar reflects the disc even if the (long) rip is
    // aborted later; the language lists come from the same main feature we rip.
    const tracks = await scanTracks(mountPath)

    const ripResult = await rip(mountPath, outFile, emit)
    if (!ripResult.ok) return ripResult

    // Sidecar carries the subtitle languages (not embeddable in MP4) plus the
    // audio languages, for the player's info badge and track labels.
    await fs.writeFile(sidecarFile, JSON.stringify(tracks), 'utf8')

    emit({ kind: 'upload', percent: 0 })
    const uploadResult = await upload(server, UPLOAD_TARGET_VPATH, [outFile, sidecarFile], (p) => {
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
