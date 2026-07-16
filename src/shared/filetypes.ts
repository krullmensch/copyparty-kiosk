export type PreviewCategory =
  | 'audio'
  | 'video'
  | 'image'
  | 'model3d'
  | 'text'
  | 'markdown'
  | 'document'
  | 'program'
  | 'unknown'

export interface PreviewCapabilities {
  quickLook: boolean
  fullOpen: boolean
  editable: boolean
}

const EXTENSION_MAP: Record<string, PreviewCategory> = {
  // audio
  mp3: 'audio',
  aac: 'audio',
  wav: 'audio',
  flac: 'audio',
  alac: 'audio',
  m4a: 'audio',
  // video
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  avi: 'video',
  webm: 'video',
  '3gp': 'video',
  '3g2': 'video',
  // image
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  svg: 'image',
  tiff: 'image',
  tif: 'image',
  gif: 'image',
  webp: 'image',
  cr2: 'image',
  cr3: 'image',
  nef: 'image',
  arw: 'image',
  dng: 'image',
  raf: 'image',
  // model3d
  splat: 'model3d',
  ply: 'model3d',
  glb: 'model3d',
  gltf: 'model3d',
  fbx: 'model3d',
  obj: 'model3d',
  usdz: 'model3d',
  stl: 'model3d',
  // markdown
  md: 'markdown',
  markdown: 'markdown',
  // text
  html: 'text',
  htm: 'text',
  py: 'text',
  css: 'text',
  js: 'text',
  ts: 'text',
  jsx: 'text',
  tsx: 'text',
  txt: 'text',
  json: 'text',
  // document
  pdf: 'document',
  mobi: 'document',
  epub: 'document',
  docx: 'document',
  odt: 'document',
  csv: 'document',
  ods: 'document',
  xlsx: 'document',
  // program
  exe: 'program',
  app: 'program',
  dmg: 'program',
  pkg: 'program'
}

const RAW_IMAGE_EXTENSIONS = new Set(['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf'])

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx < 0 || idx === filename.length - 1) return ''
  return filename.slice(idx + 1).toLowerCase()
}

export function categorize(filename: string): PreviewCategory {
  const ext = extensionOf(filename)
  return EXTENSION_MAP[ext] ?? 'unknown'
}

export function capabilitiesFor(category: PreviewCategory): PreviewCapabilities {
  switch (category) {
    case 'unknown':
      return { quickLook: false, fullOpen: false, editable: false }
    case 'program':
      return { quickLook: true, fullOpen: false, editable: false }
    case 'text':
      return { quickLook: true, fullOpen: true, editable: true }
    case 'markdown':
      return { quickLook: true, fullOpen: true, editable: true }
    default:
      return { quickLook: true, fullOpen: true, editable: false }
  }
}

export function isRawImage(filename: string): boolean {
  return RAW_IMAGE_EXTENSIONS.has(extensionOf(filename))
}

export function needsConversion(filename: string): boolean {
  const ext = extensionOf(filename)
  return ext === 'tiff' || ext === 'tif' || RAW_IMAGE_EXTENSIONS.has(ext)
}
