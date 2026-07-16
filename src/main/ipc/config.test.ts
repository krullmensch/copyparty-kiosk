import { describe, expect, it, vi } from 'vitest'

// config.ts registers ipcMain handlers on import; stub electron.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

const { sanitizeHost } = await import('./config')

describe('sanitizeHost', () => {
  it('passes a bare hostname through', () => {
    expect(sanitizeHost('kiosk2.local')).toBe('kiosk2.local')
  })

  it('passes a bare IP through', () => {
    expect(sanitizeHost('192.168.178.71')).toBe('192.168.178.71')
  })

  it('strips a scheme', () => {
    expect(sanitizeHost('http://kiosk2.local')).toBe('kiosk2.local')
  })

  it('strips a port', () => {
    expect(sanitizeHost('192.168.178.71:3923')).toBe('192.168.178.71')
  })

  it('strips scheme, port, and path together', () => {
    expect(sanitizeHost('http://kiosk2.local:3923/foo?x=1')).toBe('kiosk2.local')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeHost('  kiosk2.local  ')).toBe('kiosk2.local')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeHost('   ')).toBe('')
  })
})
