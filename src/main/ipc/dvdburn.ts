import { BrowserWindow, ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { DvdVideoBurnProgress, DvdVideoBurnResult, BurnSources, IpcChannels } from '../../shared/types'
import { download } from './copyparty'
import { isOpticalDevice, sanitizeLabel } from './cdburn'
import { getCurrentMountpoints } from './drives'

export function isDvdVideoBurnAvailable(): Promise<boolean> {
  return new Promise((res) => {
    execFile('ffmpeg', ['-version'], (errFfmpeg) => {
      if (errFfmpeg) return res(false)
      execFile('dvdauthor', ['--version'], (errDvdauthor) => {
        if (errDvdauthor) return res(false)
        execFile('growisofs', ['-version'], (errGrowisofs) => {
          res(!errGrowisofs)
        })
      })
    })
  })
}

function isUnderAllowedRoot(path: string): boolean {
  const roots = [homedir(), tmpdir(), ...getCurrentMountpoints()]
  const r = resolve(path)
  return roots.some((root) => {
    if (!root) return false
    const base = resolve(root)
    if (r === base) return true
    const prefix = base.endsWith('/') ? base : base + '/'
    return r.startsWith(prefix)
  })
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], (err, stdout) => {
      if (err || !stdout) return resolve(0)
      resolve(parseFloat(stdout.trim()))
    })
  })
}

function parseTime(timeStr: string): number {
  const parts = timeStr.split(':')
  if (parts.length !== 3) return 0
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
}

async function burnVideoDvd(
  device: string,
  inputVideo: string,
  label: string,
  emit: (p: DvdVideoBurnProgress) => void
): Promise<DvdVideoBurnResult> {
  let tmp: string | null = null
  try {
    if (!isOpticalDevice(device)) {
      return { ok: false, message: 'kein optisches Laufwerk' }
    }
    if (!isUnderAllowedRoot(inputVideo)) {
      return { ok: false, message: 'keine gültige Datei' }
    }

    tmp = await fs.mkdtemp(join(tmpdir(), 'agora-dvdburn-'))
    const mpgFile = join(tmp, 'output.mpg')
    const dvdDir = join(tmp, 'dvd')
    await fs.mkdir(dvdDir)

    const duration = await getVideoDuration(inputVideo)

    emit({ kind: 'transcode', percent: 0 })
    await new Promise<void>((res, rej) => {
      const args = ['-i', inputVideo, '-target', 'pal-dvd', '-y', mpgFile]
      const child = spawn('ffmpeg', args)
      
      child.stderr.on('data', (buf: Buffer) => {
        const text = buf.toString()
        if (duration > 0) {
          const match = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d+)/)
          if (match) {
            const current = parseTime(match[1])
            let pct = Math.round((current / duration) * 100)
            if (pct < 0) pct = 0
            if (pct > 100) pct = 100
            emit({ kind: 'transcode', percent: pct })
          }
        }
      })
      
      child.on('error', rej)
      child.on('close', (code) => {
        if (code === 0) res()
        else rej(new Error(`ffmpeg exit ${code}`))
      })
    })

    emit({ kind: 'author' })
    await new Promise<void>((res, rej) => {
      const child = spawn('dvdauthor', ['-o', dvdDir, '-t', mpgFile], { env: { ...process.env, VIDEO_FORMAT: 'PAL' } })
      child.on('error', rej)
      child.on('close', (code) => {
        if (code === 0) res()
        else rej(new Error(`dvdauthor -t exit ${code}`))
      })
    })

    await new Promise<void>((res, rej) => {
      const child = spawn('dvdauthor', ['-o', dvdDir, '-T'], { env: { ...process.env, VIDEO_FORMAT: 'PAL' } })
      child.on('error', rej)
      child.on('close', (code) => {
        if (code === 0) res()
        else rej(new Error(`dvdauthor -T exit ${code}`))
      })
    })

    emit({ kind: 'write', percent: 0 })
    await new Promise<void>((res, rej) => {
      const safeLabel = sanitizeLabel(label)
      const args = ['-dvd-compat', '-Z', device, '-V', safeLabel, '-dvd-video', dvdDir]
      const child = spawn('growisofs', args)
      
      child.stderr.on('data', (buf: Buffer) => {
        const text = buf.toString()
        const m = /(\d+(?:\.\d+)?)%\s*done/i.exec(text)
        if (m) emit({ kind: 'write', percent: Math.round(parseFloat(m[1])) })
      })
      child.stdout.on('data', (buf: Buffer) => {
        const text = buf.toString()
        const m = /(\d+(?:\.\d+)?)%\s*done/i.exec(text)
        if (m) emit({ kind: 'write', percent: Math.round(parseFloat(m[1])) })
      })
      
      child.on('error', rej)
      child.on('close', (code) => {
        if (code === 0) res()
        else rej(new Error(`growisofs exit ${code}`))
      })
    })

    emit({ kind: 'done' })
    return { ok: true }
  } catch (err: any) {
    emit({ kind: 'error', message: err.message })
    return { ok: false, message: err.message }
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

async function burnVideoDvdSources(
  device: string,
  sources: BurnSources,
  label: string,
  emit: (p: DvdVideoBurnProgress) => void
): Promise<DvdVideoBurnResult> {
  let tmpDownload: string | null = null
  try {
    let inputVideo = ''
    
    if (sources.local.length > 0) {
      inputVideo = sources.local[0]
    } else if (sources.remote && sources.remote.items.length > 0) {
      emit({ kind: 'prepare' })
      tmpDownload = await fs.mkdtemp(join(tmpdir(), 'agora-dvdburn-dl-'))
      const res = await download(sources.remote.server, tmpDownload, sources.remote.items)
      if (!res.ok) {
        return { ok: false, message: res.message ?? 'Download fehlgeschlagen' }
      }
      inputVideo = join(tmpDownload, sources.remote.items[0].name)
    }

    if (!inputVideo) {
      return { ok: false, message: 'Keine Videodatei angegeben' }
    }

    return await burnVideoDvd(device, inputVideo, label, emit)
  } catch (err: any) {
    emit({ kind: 'error', message: err.message })
    return { ok: false, message: err.message }
  } finally {
    if (tmpDownload) await fs.rm(tmpDownload, { recursive: true, force: true }).catch(() => {})
  }
}

export function registerDvdVideoBurnIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannels.DvdVideoBurnAvailable, async () => isDvdVideoBurnAvailable())
  ipcMain.handle(
    IpcChannels.DvdVideoBurnStart,
    async (_, device: string, sources: BurnSources, label: string): Promise<DvdVideoBurnResult> =>
      burnVideoDvdSources(device, sources, label, (p) =>
        window.webContents.send(IpcChannels.DvdVideoBurnProgress, p)
      )
  )
}
