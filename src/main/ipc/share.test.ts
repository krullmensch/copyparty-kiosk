import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// share.ts registers an ipcMain handler on import; stub electron. It also pulls
// in ./config (getAgoraHost) and ../agora-events (reportQrShare/extStats) --
// mocked out so createShare tests control host resolution and don't fire real
// dashboard requests through the fetch mock below.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn()
}))
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn()
}))
vi.mock('./config', () => ({
  getAgoraHost: vi.fn()
}))
vi.mock('../agora-events', () => ({
  extStats: vi.fn(() => ({})),
  reportQrShare: vi.fn()
}))

const { readFile } = await import('node:fs/promises')
const { lookup } = await import('node:dns/promises')
const { getAgoraHost } = await import('./config')
const { generateShareKey, validateShareItems, buildShareBody, buildShareUrl, createShare } =
  await import('./share')

describe('generateShareKey', () => {
  it('generates an 8-character key', () => {
    const key = generateShareKey()
    expect(key).toHaveLength(8)
  })

  it('only uses [0-9a-z] characters', () => {
    const key = generateShareKey()
    expect(/^[0-9a-z]{8}$/.test(key)).toBe(true)
  })

  it('generates different keys on each call', () => {
    const key1 = generateShareKey()
    const key2 = generateShareKey()
    expect(key1).not.toBe(key2)
  })
})

describe('validateShareItems', () => {
  it('returns "Keine Dateien ausgewählt" for empty list', () => {
    const result = validateShareItems([])
    expect(result).toBe('Keine Dateien ausgewählt')
  })

  it('returns null for a single file', () => {
    const result = validateShareItems([
      { vpath: '/foo/bar.txt', name: 'bar.txt', size: 100, isDirectory: false }
    ])
    expect(result).toBeNull()
  })

  it('returns null for multiple files', () => {
    const result = validateShareItems([
      { vpath: '/foo/a.txt', name: 'a.txt', size: 100, isDirectory: false },
      { vpath: '/foo/b.txt', name: 'b.txt', size: 200, isDirectory: false }
    ])
    expect(result).toBeNull()
  })

  it('returns null for a single folder', () => {
    const result = validateShareItems([
      { vpath: '/foo/dir', name: 'dir', size: 0, isDirectory: true }
    ])
    expect(result).toBeNull()
  })

  it('returns "Mehrere Ordner lassen sich nicht zusammen teilen" for multiple folders', () => {
    const result = validateShareItems([
      { vpath: '/foo/dir1', name: 'dir1', size: 0, isDirectory: true },
      { vpath: '/foo/dir2', name: 'dir2', size: 0, isDirectory: true }
    ])
    expect(result).toBe('Mehrere Ordner lassen sich nicht zusammen teilen')
  })

  it('returns "Ordner und Dateien lassen sich nicht zusammen teilen" for mixed files and folders', () => {
    const result = validateShareItems([
      { vpath: '/foo/file.txt', name: 'file.txt', size: 100, isDirectory: false },
      { vpath: '/foo/dir', name: 'dir', size: 0, isDirectory: true }
    ])
    expect(result).toBe('Ordner und Dateien lassen sich nicht zusammen teilen')
  })

  it('prioritizes the multi-folder error over the mix error when both apply', () => {
    const result = validateShareItems([
      { vpath: '/foo/file.txt', name: 'file.txt', size: 100, isDirectory: false },
      { vpath: '/foo/dir1', name: 'dir1', size: 0, isDirectory: true },
      { vpath: '/foo/dir2', name: 'dir2', size: 0, isDirectory: true }
    ])
    expect(result).toBe('Mehrere Ordner lassen sich nicht zusammen teilen')
  })
})

describe('buildShareBody', () => {
  it('sets k to the provided key', () => {
    const key = 'testkey1'
    const items = [{ vpath: '/foo/bar.txt', name: 'bar.txt', size: 100, isDirectory: false }]
    const body = buildShareBody(key, items)
    expect(body.k).toBe('testkey1')
  })

  it('includes file vpaths unchanged for file selection', () => {
    const items = [
      { vpath: '/foo/a.txt', name: 'a.txt', size: 100, isDirectory: false },
      { vpath: '/foo/b.txt', name: 'b.txt', size: 200, isDirectory: false }
    ]
    const body = buildShareBody('key', items)
    expect(body.vp).toEqual(['/foo/a.txt', '/foo/b.txt'])
  })

  it('adds trailing slash to folder vpath if missing', () => {
    const items = [{ vpath: '/foo/dir', name: 'dir', size: 0, isDirectory: true }]
    const body = buildShareBody('key', items)
    expect(body.vp).toEqual(['/foo/dir/'])
  })

  it('preserves trailing slash on folder vpath if already present', () => {
    const items = [{ vpath: '/foo/dir/', name: 'dir', size: 0, isDirectory: true }]
    const body = buildShareBody('key', items)
    expect(body.vp).toEqual(['/foo/dir/'])
  })

  it('sets exp to "60"', () => {
    const items = [{ vpath: '/foo/bar.txt', name: 'bar.txt', size: 100, isDirectory: false }]
    const body = buildShareBody('key', items)
    expect(body.exp).toBe('60')
  })

  it('sets perms to ["read", "get"]', () => {
    const items = [{ vpath: '/foo/bar.txt', name: 'bar.txt', size: 100, isDirectory: false }]
    const body = buildShareBody('key', items)
    expect(body.perms).toEqual(['read', 'get'])
  })

  it('sets pw to empty string', () => {
    const items = [{ vpath: '/foo/bar.txt', name: 'bar.txt', size: 100, isDirectory: false }]
    const body = buildShareBody('key', items)
    expect(body.pw).toBe('')
  })
})

describe('buildShareUrl', () => {
  it('single file ends with /s/<key>/<name>?dl', () => {
    const url = buildShareUrl('http://192.168.1.1:3923', 'mykey', [
      { vpath: '/foo/file.txt', name: 'file.txt', size: 100, isDirectory: false }
    ])
    expect(url).toBe('http://192.168.1.1:3923/s/mykey/file.txt?dl')
  })

  it('encodes filename with spaces', () => {
    const url = buildShareUrl('http://192.168.1.1:3923', 'mykey', [
      { vpath: '/foo/my file.txt', name: 'my file.txt', size: 100, isDirectory: false }
    ])
    expect(url).toBe('http://192.168.1.1:3923/s/mykey/my%20file.txt?dl')
  })

  it('encodes filename with special characters', () => {
    const url = buildShareUrl('http://192.168.1.1:3923', 'mykey', [
      { vpath: '/foo/file & stuff.pdf', name: 'file & stuff.pdf', size: 100, isDirectory: false }
    ])
    expect(url).toBe('http://192.168.1.1:3923/s/mykey/file%20%26%20stuff.pdf?dl')
  })

  it('multiple files ends with /s/<key>/?zip', () => {
    const url = buildShareUrl('http://192.168.1.1:3923', 'mykey', [
      { vpath: '/foo/a.txt', name: 'a.txt', size: 100, isDirectory: false },
      { vpath: '/foo/b.txt', name: 'b.txt', size: 200, isDirectory: false }
    ])
    expect(url).toBe('http://192.168.1.1:3923/s/mykey/?zip')
  })

  it('single folder ends with /s/<key>/?zip', () => {
    const url = buildShareUrl('http://192.168.1.1:3923', 'mykey', [
      { vpath: '/foo/dir', name: 'dir', size: 0, isDirectory: true }
    ])
    expect(url).toBe('http://192.168.1.1:3923/s/mykey/?zip')
  })
})

describe('createShare', () => {
  const item = { vpath: '/foo/bar.txt', name: 'bar.txt', size: 100, isDirectory: false }

  const fetchResponse = (ok: boolean, status: number, text: string): Response =>
    ({ ok, status, text: () => Promise.resolve(text) }) as unknown as Response

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok:false with the password error and never calls fetch when share.pw is missing', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const result = await createShare('http://kiosk2:3923', [item])

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Kein QR-Passwort gesetzt (~/.agora/share.pw)')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns ok:false with the password error and never calls fetch when share.pw is empty', async () => {
    vi.mocked(readFile).mockResolvedValue('   \n')

    const result = await createShare('http://kiosk2:3923', [item])

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Kein QR-Passwort gesetzt (~/.agora/share.pw)')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retries exactly once with a different key on a key collision, then succeeds', async () => {
    vi.mocked(readFile).mockResolvedValue('testpw')
    vi.mocked(getAgoraHost).mockResolvedValue('192.168.178.61')
    vi.mocked(fetch)
      .mockResolvedValueOnce(fetchResponse(false, 400, 'error: sharekey foo is already in use'))
      .mockResolvedValueOnce(fetchResponse(true, 201, 'created share: http://192.168.178.61:3923/s/abcdefgh/'))

    const result = await createShare('http://kiosk2:3923', [item])

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    const firstBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    const secondBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    expect(secondBody.k).not.toBe(firstBody.k)
  })

  it('does not retry a second time when the retry also collides', async () => {
    vi.mocked(readFile).mockResolvedValue('testpw')
    vi.mocked(getAgoraHost).mockResolvedValue('192.168.178.61')
    vi.mocked(fetch).mockResolvedValue(
      fetchResponse(false, 400, 'error: sharekey foo is already in use')
    )

    const result = await createShare('http://kiosk2:3923', [item])

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(false)
  })

  it('returns ok:false without a broken URL when dns.lookup throws', async () => {
    vi.mocked(readFile).mockResolvedValue('testpw')
    vi.mocked(getAgoraHost).mockResolvedValue('kiosk2.local')
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'))

    const result = await createShare('http://kiosk2:3923', [item])

    expect(result.ok).toBe(false)
    expect(result.url).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns ok:false without throwing when fetch rejects (network error)', async () => {
    vi.mocked(readFile).mockResolvedValue('testpw')
    vi.mocked(getAgoraHost).mockResolvedValue('192.168.178.61')
    vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'))

    const result = await createShare('http://kiosk2:3923', [item])

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('builds the share URL from the resolved IPv4, not the hostname', async () => {
    vi.mocked(readFile).mockResolvedValue('testpw')
    vi.mocked(getAgoraHost).mockResolvedValue('kiosk2.local')
    vi.mocked(lookup).mockResolvedValue({ address: '192.168.178.99', family: 4 })
    vi.mocked(fetch).mockResolvedValue(
      fetchResponse(true, 201, 'created share: http://kiosk2.local:3923/s/abcdefgh/')
    )

    const result = await createShare('http://kiosk2:3923', [item])

    expect(result.ok).toBe(true)
    expect(result.url).toContain('192.168.178.99')
    expect(result.url).not.toContain('kiosk2.local')
  })

  it('never leaks the share password into the ShareResult, on success or error', async () => {
    const secret = 'super-secret-share-pw'
    vi.mocked(readFile).mockResolvedValue(secret)
    vi.mocked(getAgoraHost).mockResolvedValue('192.168.178.61')
    vi.mocked(fetch).mockResolvedValue(
      fetchResponse(true, 201, 'created share: http://192.168.178.61:3923/s/abcdefgh/')
    )

    const okResult = await createShare('http://kiosk2:3923', [item])
    expect(JSON.stringify(okResult)).not.toContain(secret)

    vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'))
    const errResult = await createShare('http://kiosk2:3923', [item])
    expect(JSON.stringify(errResult)).not.toContain(secret)
  })
})
