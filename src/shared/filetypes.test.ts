import { describe, expect, it } from 'vitest'
import { capabilitiesFor, categorize, isRawImage, needsConversion } from './filetypes'
import type { PreviewCategory } from './filetypes'

describe('categorize', () => {
  const cases: Array<[string[], PreviewCategory]> = [
    [['mp3', 'aac', 'wav', 'flac', 'alac', 'm4a'], 'audio'],
    [['mp4', 'mov', 'mkv', 'avi', 'webm', '3gp', '3g2'], 'video'],
    [
      ['jpg', 'jpeg', 'png', 'svg', 'tiff', 'tif', 'gif', 'webp', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf'],
      'image'
    ],
    [['splat', 'ply', 'glb', 'gltf', 'fbx', 'obj', 'usdz', 'stl'], 'model3d'],
    [['md', 'markdown'], 'markdown'],
    [
      ['html', 'htm', 'py', 'css', 'js', 'ts', 'jsx', 'tsx', 'txt', 'json'],
      'text'
    ],
    [['pdf', 'mobi', 'epub', 'docx', 'odt', 'csv', 'ods', 'xlsx'], 'document'],
    [['exe', 'app', 'dmg', 'pkg'], 'program']
  ]

  for (const [extensions, expected] of cases) {
    for (const ext of extensions) {
      it(`categorizes .${ext} as ${expected}`, () => {
        expect(categorize(`file.${ext}`)).toBe(expected)
      })
    }
  }

  it('is case-insensitive', () => {
    expect(categorize('FOO.PNG')).toBe('image')
    expect(categorize('Bar.Md')).toBe('markdown')
  })

  it('returns unknown for unrecognized or missing extensions', () => {
    expect(categorize('file.xyz')).toBe('unknown')
    expect(categorize('noext')).toBe('unknown')
    expect(categorize('')).toBe('unknown')
  })
})

describe('capabilitiesFor', () => {
  it('returns all-false for unknown', () => {
    expect(capabilitiesFor('unknown')).toEqual({
      quickLook: false,
      fullOpen: false,
      editable: false
    })
  })

  it('returns quickLook-only for program', () => {
    expect(capabilitiesFor('program')).toEqual({
      quickLook: true,
      fullOpen: false,
      editable: false
    })
  })

  it('returns all-true for text', () => {
    expect(capabilitiesFor('text')).toEqual({
      quickLook: true,
      fullOpen: true,
      editable: true
    })
  })

  it('returns all-true for markdown', () => {
    expect(capabilitiesFor('markdown')).toEqual({
      quickLook: true,
      fullOpen: true,
      editable: true
    })
  })

  for (const category of ['audio', 'video', 'image', 'model3d', 'document'] as const) {
    it(`returns quickLook+fullOpen (not editable) for ${category}`, () => {
      expect(capabilitiesFor(category)).toEqual({
        quickLook: true,
        fullOpen: true,
        editable: false
      })
    })
  }
})

describe('isRawImage', () => {
  it('is true for RAW extensions', () => {
    for (const ext of ['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf']) {
      expect(isRawImage(`file.${ext}`)).toBe(true)
    }
  })

  it('is false for non-RAW image extensions', () => {
    expect(isRawImage('file.jpg')).toBe(false)
    expect(isRawImage('file.png')).toBe(false)
  })
})

describe('needsConversion', () => {
  it('is true for tiff/tif and RAW extensions', () => {
    for (const ext of ['tiff', 'tif', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf']) {
      expect(needsConversion(`file.${ext}`)).toBe(true)
    }
  })

  it('is false for jpg/png/gif', () => {
    expect(needsConversion('file.jpg')).toBe(false)
    expect(needsConversion('file.png')).toBe(false)
    expect(needsConversion('file.gif')).toBe(false)
  })
})
