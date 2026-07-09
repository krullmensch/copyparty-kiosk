import { describe, it, expect, vi } from 'vitest'

// cdburn imports electron + ./drives (which pulls in drivelist); stub them so
// the pure helpers can be imported in a plain node test.
vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: () => {} } }))
vi.mock('./drives', () => ({ getCurrentMountpoints: () => [] }))

const { isOpticalDevice, sanitizeLabel } = await import('./cdburn')

describe('isOpticalDevice', () => {
  it('accepts /dev/sr0 and /dev/sr12', () => {
    expect(isOpticalDevice('/dev/sr0')).toBe(true)
    expect(isOpticalDevice('/dev/sr12')).toBe(true)
  })
  it('rejects non-optical and traversal-ish paths', () => {
    expect(isOpticalDevice('/dev/sda1')).toBe(false)
    expect(isOpticalDevice('/dev/sr0; rm -rf')).toBe(false)
    expect(isOpticalDevice('/dev/srX')).toBe(false)
    expect(isOpticalDevice('')).toBe(false)
  })
})

describe('sanitizeLabel', () => {
  it('uppercases and replaces invalid chars', () => {
    expect(sanitizeLabel('my album')).toBe('MY_ALBUM')
    expect(sanitizeLabel('äöü-2024!')).toBe('____2024_')
  })
  it('caps at 32 chars', () => {
    expect(sanitizeLabel('A'.repeat(40))).toHaveLength(32)
  })
  it('falls back to AGORA when empty', () => {
    expect(sanitizeLabel('')).toBe('AGORA')
    expect(sanitizeLabel('!!!')).toBe('___')
  })
})
