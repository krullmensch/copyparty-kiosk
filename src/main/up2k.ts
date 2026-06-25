import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'

const SZM = 96 * 1024 * 1024

export interface ChunkInfo {
  hash: string
  ofs: number
  size: number
}

export interface HandshakeReply {
  purl: string
  name: string
  wark: string
  hash: string[]
  sprs: boolean
}

export type ProgressEvent =
  | { kind: 'hash'; name: string; bytesDone: number; bytesTotal: number }
  | {
      kind: 'upload'
      name: string
      bytesDone: number
      bytesTotal: number
      chunkIndex: number
      chunkCount: number
    }
  | { kind: 'retry'; name: string; attempt: number; reason: string }
  | { kind: 'done'; name: string; bytesTotal: number }
  | { kind: 'error'; name: string; message: string }

// --- hostile-network resilience tuning ---
// per-request timeout: aborts a half-open TCP that would otherwise hang forever
const CHUNK_TIMEOUT_MS = 60_000
// handshakes can be slow server-side (safededup); give them more room
const HS_TIMEOUT_MS = 120_000
// total budget measured from the LAST successful request; as long as anything
// gets through within this window the transfer keeps going (mirrors u2c --t-hs)
const RETRY_DEADLINE_MS = 180_000
// backoff between attempts, capped at the last value
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/** unrecoverable: wrong password / forbidden / permanent 4xx. never retried. */
class FatalUploadError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 5xx, 408, 429 and network/timeout failures are worth retrying; other 4xx are not. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
}

/**
 * runs `fn`, retrying transient failures with backoff until either it succeeds
 * or no request has succeeded for RETRY_DEADLINE_MS. FatalUploadError aborts
 * immediately. `deadline.last` is shared across the whole file so progress on
 * any request (chunk or handshake) keeps the transfer alive.
 */
async function retrying<T>(
  fn: () => Promise<T>,
  deadline: { last: number },
  name: string,
  emit?: (e: ProgressEvent) => void
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      const r = await fn()
      deadline.last = Date.now()
      return r
    } catch (err) {
      if (err instanceof FatalUploadError) throw err
      attempt++
      const msg = (err as Error).message
      if (Date.now() - deadline.last > RETRY_DEADLINE_MS) {
        throw new FatalUploadError(
          `server unreachable for >${RETRY_DEADLINE_MS / 1000}s; gave up: ${msg}`
        )
      }
      emit?.({ kind: 'retry', name, attempt, reason: msg })
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
    }
  }
}

export function up2kChunksize(filesize: number): number {
  let chunksize = 1024 * 1024
  let stepsize = 512 * 1024
  // mirrors copyparty/up2k.py up2k_chunksize
  while (true) {
    for (const mul of [1, 2]) {
      const nchunks = Math.ceil(filesize / chunksize)
      if (nchunks <= 256 || (chunksize >= 32 * 1024 * 1024 && nchunks <= 4096)) {
        return chunksize
      }
      chunksize += stepsize
      stepsize *= mul
    }
  }
}

function ub64(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashFile(
  filePath: string,
  size: number,
  onProgress?: (bytesHashed: number) => void
): Promise<ChunkInfo[]> {
  const chunksz = up2kChunksize(size)
  const fh = await open(filePath, 'r')
  try {
    const chunks: ChunkInfo[] = []
    const buf = Buffer.allocUnsafe(Math.min(chunksz, 4 * 1024 * 1024))
    let ofs = 0
    while (ofs < size) {
      const csz = Math.min(chunksz, size - ofs)
      const hasher = createHash('sha512')
      let rem = csz
      let pos = ofs
      while (rem > 0) {
        const want = Math.min(rem, buf.length)
        const { bytesRead } = await fh.read(buf, 0, want, pos)
        if (!bytesRead) throw new Error(`EOF at ${pos}`)
        hasher.update(buf.subarray(0, bytesRead))
        rem -= bytesRead
        pos += bytesRead
      }
      chunks.push({ hash: ub64(hasher.digest().subarray(0, 33)), ofs, size: csz })
      ofs += csz
      onProgress?.(ofs)
    }
    return chunks
  } finally {
    await fh.close()
  }
}

async function postJson(
  url: string,
  body: string,
  cookie?: string
): Promise<{ ok: boolean; status: number; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(HS_TIMEOUT_MS)
  })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

function joinUrl(server: string, path: string): string {
  if (path.startsWith('http')) return path
  return `${server}${path.startsWith('/') ? path : '/' + path}`
}

export async function handshake(args: {
  server: string
  url: string
  name: string
  size: number
  lmod: number
  hashes: string[]
  cookie?: string
}): Promise<HandshakeReply> {
  const target = joinUrl(args.server, args.url.endsWith('/') ? args.url : args.url + '/')
  const body = JSON.stringify({
    name: args.name,
    size: args.size,
    lmod: args.lmod,
    hash: args.hashes
  })
  const r = await postJson(target, body, args.cookie)
  if (!r.ok) {
    const detail = `handshake HTTP ${r.status}: ${r.text.slice(0, 300)}`
    if (r.status === 401 || r.status === 403) {
      throw new FatalUploadError(`login required or wrong password (${r.status})`)
    }
    if (!isRetryableStatus(r.status)) throw new FatalUploadError(detail)
    throw new Error(detail)
  }
  return JSON.parse(r.text) as HandshakeReply
}

async function readSlice(
  fh: import('node:fs/promises').FileHandle,
  ofs: number,
  size: number
): Promise<Uint8Array> {
  const buf = Buffer.allocUnsafe(size)
  let off = 0
  while (off < size) {
    const { bytesRead } = await fh.read(buf, off, size - off, ofs + off)
    if (!bytesRead) throw new Error(`EOF at ${ofs + off}`)
    off += bytesRead
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

// server replies 400 with these when the chunk is already present or in flight;
// for our purposes that means "this chunk is handled", not a failure to retry.
function isAlreadyHandled(status: number, txt: string): boolean {
  return (
    status === 400 &&
    (txt.includes('already being written') ||
      txt.includes('already got that') ||
      txt.includes('only sibling chunks'))
  )
}

/** throws FatalUploadError (no retry) or a plain Error (retryable) on bad responses. */
async function checkChunkResponse(res: Response, label: string): Promise<void> {
  if (res.ok) return
  const txt = await res.text()
  if (isAlreadyHandled(res.status, txt)) return // server already has it
  if (res.status === 401 || res.status === 403) {
    throw new FatalUploadError(`login required or wrong password (${res.status})`)
  }
  const detail = `${label} HTTP ${res.status}: ${txt.slice(0, 300)}`
  if (!isRetryableStatus(res.status)) throw new FatalUploadError(detail)
  throw new Error(detail)
}

export async function uploadChunk(args: {
  server: string
  purl: string
  wark: string
  chunk: ChunkInfo
  fh: import('node:fs/promises').FileHandle
  cookie?: string
}): Promise<void> {
  const url = joinUrl(args.server, args.purl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Up2k-Hash': args.chunk.hash,
    'X-Up2k-Wark': args.wark
  }
  if (args.cookie) headers['Cookie'] = args.cookie

  if (args.chunk.size <= SZM) {
    const body = await readSlice(args.fh, args.chunk.ofs, args.chunk.size)
    headers['Content-Length'] = String(args.chunk.size)
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: body as BodyInit,
      signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS)
    })
    await checkChunkResponse(res, 'chunk')
    return
  }

  // subchunking for chunks > szm (cloudflare workaround mirror of u2c.py)
  let nsub = 0
  while (true) {
    const subOfs = SZM * nsub
    if (subOfs >= args.chunk.size) return
    const subLen = Math.min(SZM, args.chunk.size - subOfs)
    const body = await readSlice(args.fh, args.chunk.ofs + subOfs, subLen)
    const subHeaders = { ...headers, 'X-Up2k-Subc': String(subOfs) }
    const res = await fetch(url, {
      method: 'POST',
      headers: subHeaders,
      body: body as BodyInit,
      signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS)
    })
    await checkChunkResponse(res, 'subchunk')
    nsub++
  }
}

export async function uploadFile(args: {
  server: string
  targetVpath: string
  filePath: string
  cookie?: string
  onProgress?: (e: ProgressEvent) => void
}): Promise<void> {
  const st = await stat(args.filePath)
  if (st.isDirectory()) throw new Error(`is directory: ${args.filePath}`)
  const name = basename(args.filePath)
  const size = st.size
  const lmod = Math.floor(st.mtimeMs / 1000)

  args.onProgress?.({ kind: 'hash', name, bytesDone: 0, bytesTotal: size })
  const chunks = await hashFile(args.filePath, size, (b) =>
    args.onProgress?.({ kind: 'hash', name, bytesDone: b, bytesTotal: size })
  )

  const hashes = chunks.map((c) => c.hash)
  const byHash = new Map(chunks.map((c) => [c.hash, c]))
  // shared budget: any successful chunk or handshake resets the deadline, so a
  // long transfer survives flaky wifi as long as it keeps making progress.
  const deadline = { last: Date.now() }

  let reply = await retrying(
    () =>
      handshake({
        server: args.server,
        url: args.targetVpath,
        name,
        size,
        lmod,
        hashes,
        cookie: args.cookie
      }),
    deadline,
    name,
    args.onProgress
  )

  if (reply.hash.length === 0) {
    args.onProgress?.({ kind: 'done', name, bytesTotal: size })
    return
  }

  const fh = await open(args.filePath, 'r')
  try {
    for (let round = 0; round < 32; round++) {
      if (reply.hash.length === 0) {
        args.onProgress?.({ kind: 'done', name, bytesTotal: size })
        return
      }
      const missingBytes = reply.hash.reduce((s, h) => s + (byHash.get(h)?.size ?? 0), 0)
      let uploadedBytes = size - missingBytes
      const total = chunks.length
      for (let i = 0; i < reply.hash.length; i++) {
        const h = reply.hash[i]
        const ci = byHash.get(h)
        if (!ci) throw new Error(`server requested unknown hash ${h}`)
        // each chunk POST retries transient failures on its own; a dropped
        // connection mid-chunk is re-sent rather than aborting the file.
        await retrying(
          () =>
            uploadChunk({
              server: args.server,
              purl: reply.purl,
              wark: reply.wark,
              chunk: ci,
              fh,
              cookie: args.cookie
            }),
          deadline,
          name,
          args.onProgress
        )
        uploadedBytes += ci.size
        args.onProgress?.({
          kind: 'upload',
          name,
          bytesDone: uploadedBytes,
          bytesTotal: size,
          chunkIndex: total - reply.hash.length + i + 1,
          chunkCount: total
        })
      }
      // re-handshake confirms what landed; on resume the server only asks for
      // whatever is still missing or failed verification.
      reply = await retrying(
        () =>
          handshake({
            server: args.server,
            url: reply.purl,
            name,
            size,
            lmod,
            hashes,
            cookie: args.cookie
          }),
        deadline,
        name,
        args.onProgress
      )
    }
    throw new Error(`gave up after 32 handshake rounds; still missing ${reply.hash.length} chunks`)
  } finally {
    await fh.close()
  }
}
