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

const { parseRawAudioLangs, sanitizeName } = await import('./dvdrip')

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

describe('parseRawAudioLangs', () => {
  it('keeps every track in order, not deduped (for --aname track count)', () => {
    const scan = {
      MainFeature: 1,
      TitleList: [
        {
          Index: 1,
          AudioList: [
            { LanguageCode: 'eng' },
            { LanguageCode: 'eng' },
            { LanguageCode: 'deu' }
          ]
        }
      ]
    }
    expect(parseRawAudioLangs(`JSON Title Set: ${JSON.stringify(scan)}`)).toEqual([
      'eng',
      'eng',
      'deu'
    ])
  })

  it('defaults a track with no LanguageCode to "und"', () => {
    const scan = {
      MainFeature: 1,
      TitleList: [{ Index: 1, AudioList: [{}, { LanguageCode: 'eng' }] }]
    }
    expect(parseRawAudioLangs(`JSON Title Set: ${JSON.stringify(scan)}`)).toEqual(['und', 'eng'])
  })

  it('returns an empty list when there is no JSON to parse', () => {
    expect(parseRawAudioLangs('no scan output')).toEqual([])
  })
})
