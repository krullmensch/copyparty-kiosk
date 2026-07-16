import { describe, expect, it, vi } from 'vitest'

// cdrip.ts imports electron + ./copyparty (which pulls in electron net); stub
// both so the pure parsers can be imported in isolation.
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./copyparty', () => ({
  upload: vi.fn()
}))

const { isOpticalDevice, sanitizeName, parseTrackCount, parseCdText } = await import('./cdrip')

describe('isOpticalDevice', () => {
  it('accepts /dev/sr0 and /dev/sr12', () => {
    expect(isOpticalDevice('/dev/sr0')).toBe(true)
    expect(isOpticalDevice('/dev/sr12')).toBe(true)
  })
  it('rejects non-optical and injection-ish paths', () => {
    expect(isOpticalDevice('/dev/sda1')).toBe(false)
    expect(isOpticalDevice('/dev/sr0; rm -rf')).toBe(false)
    expect(isOpticalDevice('/dev/srX')).toBe(false)
    expect(isOpticalDevice('')).toBe(false)
  })
})

describe('sanitizeName', () => {
  it('keeps a filesystem/vpath-safe stem', () => {
    expect(sanitizeName('Abbey_Road')).toBe('Abbey_Road')
  })

  it('replaces unsafe characters and trims leading/trailing separators', () => {
    expect(sanitizeName('Amélie: Le Fabuleux Destin')).toBe('Am_lie_Le_Fabuleux_Destin')
    expect(sanitizeName('__Dark Side!__')).toBe('Dark_Side')
  })

  it('caps at 64 chars', () => {
    expect(sanitizeName('A'.repeat(80))).toHaveLength(64)
  })

  it('falls back to Audio-CD for empty or all-unsafe input', () => {
    expect(sanitizeName('')).toBe('Audio-CD')
    expect(sanitizeName('???')).toBe('Audio-CD')
  })
})

describe('parseTrackCount', () => {
  it('counts tracks from a realistic cdparanoia -Q TOC', () => {
    const stderr = `cdparanoia III release 10.2 (September 11, 2008)

Table of contents (audio tracks only):
track        length               begin        copy pre ch
===========================================================
  1.    17811 [03:57.36]        0 [00:00.00]    no   no  2
  2.    12345 [02:44.45]    17811 [03:57.36]    no   no  2
  3.     9876 [02:11.51]    30156 [06:42.06]    no   no  2
TOTAL   40032 [08:53.32]    (audio only)
`
    expect(parseTrackCount(stderr)).toBe(3)
  })

  it('returns 0 for empty or garbage input', () => {
    expect(parseTrackCount('')).toBe(0)
    expect(parseTrackCount('cdparanoia: no such device or address')).toBe(0)
  })
})

describe('parseCdText', () => {
  it('extracts the album and per-track titles from a CD-TEXT dump', () => {
    const stdout = `CD-TEXT for Disc:
        TITLE: The Dark Side of the Moon
        PERFORMER: Pink Floyd

CD-TEXT for Track 1:
        TITLE: Speak to Me
        PERFORMER: Pink Floyd

CD-TEXT for Track 2:
        TITLE: Breathe
        PERFORMER: Pink Floyd
`
    expect(parseCdText(stdout)).toEqual({
      album: 'The Dark Side of the Moon',
      tracks: { 1: 'Speak to Me', 2: 'Breathe' }
    })
  })

  it('finds the album even when an ISRC track list precedes the CD-TEXT (real cd-info layout)', () => {
    const stdout = `CD-ROM Track List (1 - 11)
TRACK  1 ISRC: DELJ81899038
TRACK  2 ISRC: DELJ81899214
CD-TEXT for Disc:
	TITLE: nie
	PERFORMER: Fynn Kliemann
CD-TEXT for Track  1:
	TITLE: Morgen
	PERFORMER: Fynn Kliemann
CD-TEXT for Track  2:
	TITLE: Bis Seattle
	PERFORMER: Fynn Kliemann
`
    expect(parseCdText(stdout)).toEqual({
      album: 'nie',
      tracks: { 1: 'Morgen', 2: 'Bis Seattle' }
    })
  })

  it('returns empty tracks (no throw) when there is no CD-TEXT section', () => {
    const stdout = `cd-info version 10.7\nCDDB disc ID: 0x00051207\nTrack   1: 0 00:02:32:63\n`
    expect(parseCdText(stdout)).toEqual({ tracks: {} })
  })
})
