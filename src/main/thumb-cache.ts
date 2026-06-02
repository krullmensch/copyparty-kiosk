import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join, parse } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import sharp from 'sharp'

const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif'
])

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi'])
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.wav', '.aif', '.aiff'])
const PDF_EXTS = new Set(['.pdf'])

function spawnCollect(cmd: string, args: string[], timeoutMs = 10000): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: Buffer | null): void => {
      if (done) return
      done = true
      resolve(v)
    }
    let p
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return finish(null)
    }
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish(null)
    }, timeoutMs)
    p.stdout.on('data', (c) => chunks.push(c as Buffer))
    p.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || chunks.length === 0) return finish(null)
      finish(Buffer.concat(chunks))
    })
  })
}

async function rawFor(path: string, ext: string): Promise<Buffer | null> {
  if (IMAGE_EXTS.has(ext)) {
    return null // sharp reads file directly
  }
  if (VIDEO_EXTS.has(ext)) {
    return spawnCollect('ffmpeg', [
      '-loglevel', 'error',
      '-ss', '00:00:01',
      '-i', path,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ])
  }
  if (AUDIO_EXTS.has(ext)) {
    return spawnCollect('ffmpeg', [
      '-loglevel', 'error',
      '-i', path,
      '-an',
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ])
  }
  if (PDF_EXTS.has(ext)) {
    return spawnCollect('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', path, '-'])
  }
  return null
}

function isSupportedExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext) || PDF_EXTS.has(ext)
}

const THUMB_SIZE = 256
const THUMB_QUALITY = 78
const ROOT_BUCKET = '_root'

let cacheRoot: string | null = null
let knownMounts: string[] = []

function root(): string {
  if (!cacheRoot) {
    cacheRoot = join(app.getPath('userData'), 'thumb-cache')
  }
  return cacheRoot
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

export function setKnownMounts(mounts: string[]): void {
  knownMounts = [...mounts].sort((a, b) => b.length - a.length)
}

function bucketFor(path: string): string {
  for (const m of knownMounts) {
    if (path === m || path.startsWith(m.endsWith('/') ? m : `${m}/`)) {
      return sha1(m)
    }
  }
  return ROOT_BUCKET
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function getThumb(path: string): Promise<string | null> {
  const ext = parse(path).ext.toLowerCase()
  if (!isSupportedExt(ext)) return null

  let st: import('node:fs').Stats
  try {
    st = await fs.stat(path)
  } catch {
    return null
  }
  if (!st.isFile()) return null

  const bucket = bucketFor(path)
  const key = sha1(`${path}|${st.mtimeMs}|${st.size}`)
  const bucketDir = join(root(), bucket)
  const cachePath = join(bucketDir, `${key}.webp`)

  try {
    const cached = await fs.readFile(cachePath)
    return `data:image/webp;base64,${cached.toString('base64')}`
  } catch {
    // miss — generate
  }

  try {
    const src: string | Buffer = IMAGE_EXTS.has(ext) ? path : (await rawFor(path, ext)) ?? Buffer.alloc(0)
    if (typeof src !== 'string' && src.length === 0) return null
    const buf = await sharp(src, { failOn: 'none' })
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer()
    await ensureDir(bucketDir)
    await fs.writeFile(cachePath, buf)
    return `data:image/webp;base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn('[thumb-cache] generate failed:', path, (err as Error).message)
    return null
  }
}

export async function dropBucket(mountpoint: string): Promise<void> {
  const dir = join(root(), sha1(mountpoint))
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (err) {
    console.warn('[thumb-cache] dropBucket failed:', mountpoint, (err as Error).message)
  }
}
