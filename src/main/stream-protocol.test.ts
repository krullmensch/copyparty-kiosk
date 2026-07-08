import { describe, expect, it, vi } from 'vitest'

// stream-protocol.ts imports `electron` (app, protocol) at module top-level, plus
// two sibling main-process modules that themselves pull in drivelist/up2k/etc.
// None of that is touched by parseRangeHeader (it's called only inside request
// handlers, never at import time), so stub them out just enough for the module
// to load without executing real Electron/native code.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }
}))
vi.mock('./ipc/copyparty', () => ({
  getCookieHeader: vi.fn(),
  isKnownServer: vi.fn()
}))
vi.mock('./ipc/drives', () => ({
  getCurrentMountpoints: vi.fn(() => [])
}))

const { parseRangeHeader } = await import('./stream-protocol')

describe('parseRangeHeader', () => {
  const fileSize = 1000

  it('returns null for no header', () => {
    expect(parseRangeHeader(null, fileSize)).toBeNull()
  })

  it('parses a bounded range', () => {
    expect(parseRangeHeader('bytes=0-99', fileSize)).toEqual({ start: 0, end: 99 })
  })

  it('parses an open-ended range', () => {
    expect(parseRangeHeader('bytes=100-', fileSize)).toEqual({ start: 100, end: 999 })
  })

  it('parses a suffix range', () => {
    expect(parseRangeHeader('bytes=-100', fileSize)).toEqual({ start: 900, end: 999 })
  })

  it('returns null for invalid/garbage headers', () => {
    expect(parseRangeHeader('garbage', fileSize)).toBeNull()
    expect(parseRangeHeader('bytes=', fileSize)).toBeNull()
    expect(parseRangeHeader('bytes=-', fileSize)).toBeNull()
  })

  it('returns null for multi-range requests', () => {
    expect(parseRangeHeader('bytes=0-10,20-30', fileSize)).toBeNull()
  })

  it('returns null for unsatisfiable ranges (start beyond EOF)', () => {
    expect(parseRangeHeader('bytes=1000-1100', fileSize)).toBeNull()
    expect(parseRangeHeader('bytes=5000-', fileSize)).toBeNull()
  })

  it('clamps an end beyond EOF to the last byte', () => {
    expect(parseRangeHeader('bytes=900-2000', fileSize)).toEqual({ start: 900, end: 999 })
  })

  it('returns null when start > end', () => {
    expect(parseRangeHeader('bytes=500-100', fileSize)).toBeNull()
  })
})
