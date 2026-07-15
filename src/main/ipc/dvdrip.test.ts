import { describe, expect, it, vi } from 'vitest'

// dvdrip.ts imports electron + ./copyparty (which pulls in electron net); stub
// both so the pure parsers can be imported in isolation.
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./copyparty', () => ({
  upload: vi.fn()
}))

const { parseScanJson, sanitizeName } = await import('./dvdrip')

describe('parseScanJson', () => {
  // Mirrors the real Jurassic World scan: EN+DE audio, EN/DE/IT VOBSUB subs.
  const scan = {
    MainFeature: 1,
    TitleList: [
      {
        Index: 1,
        AudioList: [
          { LanguageCode: 'eng' },
          { LanguageCode: 'eng' },
          { LanguageCode: 'deu' }
        ],
        SubtitleList: [
          { LanguageCode: 'eng' },
          { LanguageCode: 'deu' },
          { LanguageCode: 'ita' }
        ]
      }
    ]
  }

  it('extracts deduped audio + subtitle languages from the main feature', () => {
    const stdout = `Scanning title 1...\nJSON Title Set: ${JSON.stringify(scan)}\n[done]`
    expect(parseScanJson(stdout)).toEqual({
      audio: ['eng', 'deu'],
      subtitles: ['eng', 'deu', 'ita']
    })
  })

  it('picks the title whose Index matches MainFeature', () => {
    const multi = {
      MainFeature: 2,
      TitleList: [
        { Index: 1, AudioList: [{ LanguageCode: 'fra' }], SubtitleList: [] },
        { Index: 2, AudioList: [{ LanguageCode: 'eng' }], SubtitleList: [{ LanguageCode: 'deu' }] }
      ]
    }
    expect(parseScanJson(`JSON Title Set: ${JSON.stringify(multi)}`)).toEqual({
      audio: ['eng'],
      subtitles: ['deu']
    })
  })

  it('falls back to the first title when MainFeature is absent', () => {
    const noMain = {
      TitleList: [{ Index: 3, AudioList: [{ LanguageCode: 'eng' }], SubtitleList: [] }]
    }
    expect(parseScanJson(`JSON Title Set: ${JSON.stringify(noMain)}`)).toEqual({
      audio: ['eng'],
      subtitles: []
    })
  })

  it('returns empty lists for output with no JSON', () => {
    expect(parseScanJson('libdvdcss error, no title set')).toEqual({ audio: [], subtitles: [] })
  })

  it('returns empty lists for malformed JSON', () => {
    expect(parseScanJson('JSON Title Set: { not valid json ')).toEqual({
      audio: [],
      subtitles: []
    })
  })
})

describe('sanitizeName', () => {
  it('keeps a filesystem/vpath-safe stem', () => {
    expect(sanitizeName('JURASSIC_WORLD')).toBe('JURASSIC_WORLD')
  })

  it('replaces unsafe characters and trims separators', () => {
    expect(sanitizeName('Amélie: Le Fabuleux Destin')).toBe('Am_lie_Le_Fabuleux_Destin')
  })

  it('falls back to a default for an empty result', () => {
    expect(sanitizeName('///')).toBe('DVD-Rip')
  })
})
