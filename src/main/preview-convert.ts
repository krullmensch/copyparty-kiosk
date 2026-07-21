import { promises as fs } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import decodeHeic from 'heic-decode'
import { exiftool } from 'exiftool-vendored'
import { isRawImage } from '../shared/filetypes'
import { getPreviewCacheDir } from './stream-protocol'

export interface ConvertOk {
  ok: true
  cacheKey: string
  /** true if an existing cache entry was reused (no sharp/exiftool call happened). */
  cached: boolean
}

export interface ConvertErr {
  ok: false
  error: string
}

export type ConvertResult = ConvertOk | ConvertErr

const TIFF_EXTS = new Set(['.tif', '.tiff'])
const HEIC_EXTS = new Set(['.heic', '.heif'])
const MAX_DIMENSION = 4096

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

/** Deterministic cache filename: sha1(absPath|mtimeMs|size) + target extension. */
function cacheKeyFor(absPath: string, mtimeMs: number, size: number, targetExt: string): string {
  return `${sha1(`${absPath}|${mtimeMs}|${size}`)}${targetExt}`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Runs `write(tmpPath)` to populate a temp file inside `cacheDir`, then
 * renames it into place. Guarantees the `kiosk-stream://converted` route
 * (which streams straight from `cacheDir`) never observes a half-written
 * file. Cleans up the temp file on failure.
 */
async function writeAtomically(
  cacheDir: string,
  finalPath: string,
  write: (tmpPath: string) => Promise<void>
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true })
  const tmpPath = join(cacheDir, `.tmp-${randomUUID()}`)
  try {
    await write(tmpPath)
    await fs.rename(tmpPath, finalPath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true })
    throw err
  }
}

async function convertTiff(absPath: string, destPath: string): Promise<void> {
  await sharp(absPath)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(destPath)
}

async function convertHeic(absPath: string, destPath: string): Promise<void> {
  const buffer = await fs.readFile(absPath)
  const { width, height, data } = await decodeHeic({ buffer })
  await sharp(Buffer.from(data), {
    raw: {
      width,
      height,
      channels: 4
    }
  })
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg()
    .toFile(destPath)
}

/**
 * RAW preview extraction, in order of preference: JpgFromRaw (Nikon/
 * Panasonic) → PreviewImage (Canon/Fuji/Olympus/Sony) → low-res thumbnail.
 * Only throws once all three have failed.
 */
async function extractRawPreview(absPath: string, destPath: string): Promise<void> {
  const extractors: Array<(src: string, dest: string) => Promise<void>> = [
    (src, dest) => exiftool.extractJpgFromRaw(src, dest),
    (src, dest) => exiftool.extractPreview(src, dest),
    (src, dest) => exiftool.extractThumbnail(src, dest)
  ]

  let lastErr: unknown
  for (const extractor of extractors) {
    try {
      await extractor(absPath, destPath)
      return
    } catch (err) {
      lastErr = err
      await fs.rm(destPath, { force: true })
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('no embedded preview')
}

/**
 * Core conversion logic with an injectable cache directory (for testing
 * without Electron's `app.getPath`). See `convertForPreview` for the real
 * entry point.
 */
export async function convertForPreviewInto(
  cacheDir: string,
  absPath: string
): Promise<ConvertResult> {
  const ext = extname(absPath).toLowerCase()
  const isTiff = TIFF_EXTS.has(ext)
  const isHeic = HEIC_EXTS.has(ext)
  const isRaw = isRawImage(absPath)

  if (!isTiff && !isRaw && !isHeic) {
    return { ok: false, error: 'no conversion for this type' }
  }

  let mtimeMs: number
  let size: number
  try {
    const st = await fs.stat(absPath)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch {
    return { ok: false, error: 'source not found' }
  }

  const targetExt = isTiff ? '.png' : '.jpg'
  const cacheKey = cacheKeyFor(absPath, mtimeMs, size, targetExt)
  const finalPath = join(cacheDir, cacheKey)

  if (await fileExists(finalPath)) {
    return { ok: true, cacheKey, cached: true }
  }

  try {
    if (isTiff) {
      await writeAtomically(cacheDir, finalPath, (tmp) => convertTiff(absPath, tmp))
    } else if (isHeic) {
      await writeAtomically(cacheDir, finalPath, (tmp) => convertHeic(absPath, tmp))
    } else {
      await writeAtomically(cacheDir, finalPath, (tmp) => extractRawPreview(absPath, tmp))
    }
  } catch (err) {
    return {
      ok: false,
      error: isRaw ? 'no embedded preview' : err instanceof Error ? err.message : String(err)
    }
  }

  return { ok: true, cacheKey, cached: false }
}

/** Real entry point: converts into the shared preview cache dir. */
export async function convertForPreview(absPath: string): Promise<ConvertResult> {
  return convertForPreviewInto(getPreviewCacheDir(), absPath)
}
