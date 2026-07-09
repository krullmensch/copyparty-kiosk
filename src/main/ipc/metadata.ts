import { app, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { exiftool, type WriteTags } from 'exiftool-vendored'
import {
  FileMetadata,
  IpcChannels,
  MetadataWriteResult,
  PreviewConvertResult,
  PreviewSource,
  ReadTextResult
} from '../../shared/types'
import { fetchRemoteText, fetchRemoteBytes, putRemoteFile } from './copyparty'
import { convertForPreview } from '../preview-convert'

// Whole-file byte reads (audio decode, 3D models) are capped to keep them off
// the streaming path and out of unbounded memory.
const MAX_PREVIEW_BYTES = 150 * 1024 * 1024

/** first present string/number field among `keys`, trimmed. */
export function pick(tags: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = tags[k]
    if (typeof v === 'string') {
      const s = v.trim()
      if (s) return s
    } else if (typeof v === 'number') {
      return String(v)
    }
  }
  return undefined
}

export function dimensions(tags: Record<string, unknown>): string | undefined {
  const w = tags.ImageWidth
  const h = tags.ImageHeight
  if (typeof w === 'number' && typeof h === 'number') return `${w}×${h}`
  return undefined
}

/** exiftool Duration is `number | string` — "0:03:24", "12.5 s", "12", 204. */
export function parseDuration(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (/^\d+(:\d+){1,2}$/.test(s)) {
    return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
  }
  const m = s.match(/^([\d.]+)\s*s?$/i)
  if (m) {
    const n = parseFloat(m[1])
    return Number.isNaN(n) ? undefined : n
  }
  const n = parseFloat(s)
  return Number.isNaN(n) ? undefined : n
}

/** ExifDateTime (has toISOString) or a plain date string → ISO. */
export function toISO(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'object' && typeof (v as { toISOString?: unknown }).toISOString === 'function') {
    const iso = (v as { toISOString: () => string | undefined }).toISOString()
    return typeof iso === 'string' ? iso : undefined
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  return undefined
}

/** exiftool tag object → FileMetadata (shared by local and remote paths). */
function normalizeMetadata(tags: Record<string, unknown>, writable: boolean): FileMetadata {
  const raw: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(tags)) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number') raw[k] = v
    else if (typeof v !== 'function') raw[k] = String(v)
  }
  return {
    writable,
    common: {
      title: pick(tags, ['Title', 'TrackTitle']),
      comment: pick(tags, ['Comment', 'UserComment', 'Description']),
      author: pick(tags, ['Artist', 'Author', 'Creator']),
      dimensions: dimensions(tags),
      duration: parseDuration(tags.Duration),
      dateTaken: toISO(tags.DateTimeOriginal ?? tags.CreateDate)
    },
    raw
  }
}

function commonToTags(patch: Partial<FileMetadata['common']>): WriteTags {
  const tags: WriteTags = {}
  if (patch.title !== undefined) tags.Title = patch.title
  if (patch.comment !== undefined) tags.Comment = patch.comment
  if (patch.author !== undefined) tags.Artist = patch.author
  return tags
}

async function readLocalMetadata(path: string): Promise<FileMetadata> {
  const tags = (await exiftool.read(path)) as unknown as Record<string, unknown>
  return normalizeMetadata(tags, true)
}

async function writeLocalMetadata(
  path: string,
  patch: Partial<FileMetadata['common']>
): Promise<MetadataWriteResult> {
  const tags = commonToTags(patch)
  if (Object.keys(tags).length === 0) return { ok: true }
  try {
    await exiftool.write(path, tags, ['-overwrite_original'])
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

// Remote metadata means round-tripping the whole file (download → exiftool →
// upload), so cap it. Covers images/audio/small clips; larger files stay
// read-only.
const META_MAX = 64 * 1024 * 1024

/** temp file with the source's extension — exiftool needs it to detect format. */
async function withTempCopy<T>(
  vpath: string,
  bytes: Uint8Array,
  fn: (tmp: string) => Promise<T>
): Promise<T> {
  const ext = extname(vpath) || ''
  const tmp = join(tmpdir(), `cpp-meta-${randomUUID()}${ext}`)
  await fs.writeFile(tmp, bytes)
  try {
    return await fn(tmp)
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

async function readRemoteMetadata(server: string, vpath: string): Promise<FileMetadata> {
  const bytes = await fetchRemoteBytes(server, vpath, META_MAX)
  if (!bytes) {
    return { writable: false, common: {}, raw: { note: 'Datei zu groß oder nicht lesbar' } }
  }
  try {
    return await withTempCopy(vpath, bytes, async (tmp) => {
      const tags = (await exiftool.read(tmp)) as unknown as Record<string, unknown>
      return normalizeMetadata(tags, true)
    })
  } catch (err) {
    return {
      writable: false,
      common: {},
      raw: { note: err instanceof Error ? err.message : 'Metadaten nicht lesbar' }
    }
  }
}

async function writeRemoteMetadata(
  server: string,
  vpath: string,
  patch: Partial<FileMetadata['common']>
): Promise<MetadataWriteResult> {
  const tags = commonToTags(patch)
  if (Object.keys(tags).length === 0) return { ok: true }
  const bytes = await fetchRemoteBytes(server, vpath, META_MAX)
  if (!bytes) return { ok: false, message: 'Datei zu groß oder nicht lesbar' }
  try {
    return await withTempCopy(vpath, bytes, async (tmp) => {
      await exiftool.write(tmp, tags, ['-overwrite_original'])
      const updated = new Uint8Array(await fs.readFile(tmp))
      const res = await putRemoteFile(server, vpath, updated)
      return res.ok ? { ok: true } : { ok: false, message: res.message }
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

async function readLocalText(path: string, maxBytes: number): Promise<ReadTextResult> {
  const handle = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0)
    const { size } = await handle.stat()
    return {
      text: buf.subarray(0, bytesRead).toString('utf-8'),
      truncated: size > maxBytes
    }
  } finally {
    await handle.close()
  }
}

export function registerMetadataIpc(): void {
  ipcMain.handle(
    IpcChannels.PreviewMetadata,
    async (_, source: PreviewSource): Promise<FileMetadata> => {
      if (source.kind === 'local') return readLocalMetadata(source.path)
      return readRemoteMetadata(source.server, source.vpath)
    }
  )

  ipcMain.handle(
    IpcChannels.PreviewMetadataWrite,
    async (
      _,
      source: PreviewSource,
      patch: Partial<FileMetadata['common']>
    ): Promise<MetadataWriteResult> => {
      if (source.kind === 'local') return writeLocalMetadata(source.path, patch)
      return writeRemoteMetadata(source.server, source.vpath, patch)
    }
  )

  ipcMain.handle(
    IpcChannels.PreviewReadText,
    async (_, source: PreviewSource, maxBytes: number): Promise<ReadTextResult> => {
      if (source.kind !== 'local') {
        return fetchRemoteText(source.server, source.vpath, maxBytes)
      }
      return readLocalText(source.path, maxBytes)
    }
  )

  ipcMain.handle(
    IpcChannels.PreviewConvert,
    async (_, source: PreviewSource): Promise<PreviewConvertResult> => {
      // Conversion (TIFF/RAW → PNG/JPG) only for local files; remote non-native
      // images are not supported in v1 (would need download-first).
      if (source.kind !== 'local') return { ok: false, error: 'remote conversion unsupported' }
      const res = await convertForPreview(source.path)
      return res.ok ? { ok: true, cacheKey: res.cacheKey } : { ok: false, error: res.error }
    }
  )

  ipcMain.handle(
    IpcChannels.PreviewReadBytes,
    async (_, source: PreviewSource): Promise<Uint8Array | null> => {
      try {
        if (source.kind === 'local') {
          const st = await fs.stat(source.path)
          if (st.size > MAX_PREVIEW_BYTES) return null
          return new Uint8Array(await fs.readFile(source.path))
        }
        return fetchRemoteBytes(source.server, source.vpath, MAX_PREVIEW_BYTES)
      } catch {
        return null
      }
    }
  )

  app.on('will-quit', () => {
    void exiftool.end()
  })
}
