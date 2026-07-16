import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { DvdRipProgress, DvdRipResult, IpcChannels } from '../../shared/types'
import { langLabel } from '../../shared/langNames'
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

/** Find the scanned main feature title, falling back to the first title. Exported for testability. */
export function selectMainTitle(scan: HbScan): HbScanTitle | undefined {
  const titles = scan.TitleList ?? []
  return titles.find((t) => t.Index === scan.MainFeature) ?? titles[0]
}

function parseScan(stdout: string): HbScan | null {
  const json = extractTitleSetJson(stdout)
  if (!json) return null
  try {
    return JSON.parse(json) as HbScan
  } catch {
    return null
  }
}

/**
 * Parse a HandBrakeCLI `--json` scan into the main feature's audio language
 * codes, one per track in scan order, NOT deduped -- `--all-audio` keeps every
 * track (e.g. a disc can carry two English tracks at different bitrates), and
 * `--aname` needs exactly one name per resulting track to label them correctly.
 * Exported for testability.
 */
export function parseRawAudioLangs(stdout: string): string[] {
  const scan = parseScan(stdout)
  if (!scan) return []
  const main = selectMainTitle(scan)
  if (!main) return []
  return (main.AudioList ?? []).map((e) => e.LanguageCode ?? 'und')
}

/** Scan a mounted video DVD for its main feature's audio track languages. */
async function scanTracks(mountPath: string): Promise<{ rawAudioLangs: string[] }> {
  try {
    // HandBrake prints its log (incl. the "JSON Title Set:" banner) to stderr;
    // parse both streams. Bump maxBuffer well past the default 1 MB.
    const { stdout, stderr } = await execFileAsync(
      'HandBrakeCLI',
      ['-i', mountPath, '--main-feature', '--scan', '--json'],
      { maxBuffer: 32 * 1024 * 1024 }
    )
    return { rawAudioLangs: parseRawAudioLangs(stdout + stderr) }
  } catch {
    return { rawAudioLangs: [] }
  }
}

function rip(
  mountPath: string,
  outFile: string,
  audioNames: string[],
  emit: (p: DvdRipProgress) => void
): Promise<DvdRipResult> {
  return new Promise((resolvePromise) => {
    // MP4 container so the rip plays natively in the kiosk's Chromium <video>
    // (MKV does not). Every audio language is kept and transcoded to AAC (Chromium
    // can't decode the DVD's native AC3). DVD subtitles are VOBSUB bitmaps -- MP4
    // can't carry them and no browser player renders VOBSUB, so they're dropped
    // entirely rather than tracked in a sidecar nobody could use.
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
    // Without --aname, Chromium's audio-track menu falls back to a generic
    // channel-layout label ("Stereo") for every track, indistinguishable from
    // each other. Name each track by its scanned language so the player's
    // audio-track menu reads e.g. "English"/"Deutsch" instead. Length must
    // match the track count HandBrake produces from --all-audio exactly, or
    // HandBrake errors -- only pass it when the pre-encode scan succeeded.
    if (audioNames.length > 0) {
      args.push('--aname', audioNames.join(','))
    }

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
  try {
    const { rawAudioLangs } = await scanTracks(mountPath)
    const audioNames = rawAudioLangs.map(langLabel)

    const ripResult = await rip(mountPath, outFile, audioNames, emit)
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
