import { describe, expect, it, vi } from 'vitest'

// metadata.ts imports electron (app, ipcMain), exiftool-vendored, and two sibling
// main-process modules that pull in native/Electron-only code (up2k, sharp, ...).
// None of that is exercised by the pure normalization helpers under test here
// (pick/dimensions/parseDuration/toISO — exported for testability, logic unchanged),
// so stub just enough for the module to load.
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('exiftool-vendored', () => ({
  exiftool: { read: vi.fn(), write: vi.fn(), end: vi.fn() }
}))
vi.mock('./copyparty', () => ({
  fetchRemoteText: vi.fn(),
  fetchRemoteBytes: vi.fn()
}))
vi.mock('../preview-convert', () => ({
  convertForPreview: vi.fn()
}))

const { pick, dimensions, parseDuration, toISO } = await import('./metadata')

describe('pick', () => {
  it('returns the first present, trimmed string field', () => {
    expect(pick({ Title: '  Hello  ' }, ['Title', 'TrackTitle'])).toBe('Hello')
  })

  it('stringifies a numeric field', () => {
    expect(pick({ TrackTitle: 42 }, ['Title', 'TrackTitle'])).toBe('42')
  })

  it('skips a blank string and falls through to the next key', () => {
    expect(pick({ Title: '   ', TrackTitle: 'Foo' }, ['Title', 'TrackTitle'])).toBe('Foo')
  })

  it('returns undefined when none of the keys are present', () => {
    expect(pick({}, ['Title', 'TrackTitle'])).toBeUndefined()
  })
})

describe('dimensions', () => {
  it('formats width×height when both are numbers', () => {
    expect(dimensions({ ImageWidth: 1920, ImageHeight: 1080 })).toBe('1920×1080')
  })

  it('returns undefined when width or height is missing', () => {
    expect(dimensions({ ImageWidth: 1920 })).toBeUndefined()
    expect(dimensions({})).toBeUndefined()
  })
})

describe('parseDuration', () => {
  it('passes through a plain number', () => {
    expect(parseDuration(204)).toBe(204)
  })

  it('parses H:MM:SS / MM:SS into seconds', () => {
    expect(parseDuration('0:03:24')).toBe(204)
  })

  it('parses a "N s" string', () => {
    expect(parseDuration('12.5 s')).toBe(12.5)
  })

  it('parses a bare numeric string', () => {
    expect(parseDuration('12')).toBe(12)
  })

  it('returns undefined for non-numeric/non-string input', () => {
    expect(parseDuration(null)).toBeUndefined()
    expect(parseDuration(undefined)).toBeUndefined()
    expect(parseDuration({})).toBeUndefined()
  })

  it('returns undefined for an unparsable string', () => {
    expect(parseDuration('abc')).toBeUndefined()
  })
})

describe('toISO', () => {
  it('returns undefined for null/undefined', () => {
    expect(toISO(null)).toBeUndefined()
    expect(toISO(undefined)).toBeUndefined()
  })

  it('uses toISOString() on ExifDateTime-like objects', () => {
    const exifDate = { toISOString: () => '2020-01-01T00:00:00.000Z' }
    expect(toISO(exifDate)).toBe('2020-01-01T00:00:00.000Z')
  })

  it('returns undefined when toISOString() yields a non-string', () => {
    const broken = { toISOString: () => undefined }
    expect(toISO(broken)).toBeUndefined()
  })

  it('converts a parseable date string to ISO', () => {
    expect(toISO('2020-01-01')).toBe(new Date('2020-01-01').toISOString())
  })

  it('returns undefined for an unparsable date string', () => {
    expect(toISO('not a date')).toBeUndefined()
  })
})
