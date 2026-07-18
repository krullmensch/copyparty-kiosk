export interface DriveInfo {
  id: string
  device: string
  description: string
  size: number | null
  isUSB: boolean
  isRemovable: boolean
  isSystem: boolean
  /** optical drive (CD/DVD/BD). Shown even without a mounted disc, as a burn target. */
  isOptical: boolean
  /** audio CD / CDDA disc -- no mounted filesystem, ripped via cdparanoia. */
  isAudioCd?: boolean
  mountpoints: { path: string; label?: string | null }[]
}

export type BurnProgress =
  | { kind: 'prepare' }
  | { kind: 'blank' }
  | { kind: 'write'; percent: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export interface BurnResult {
  ok: boolean
  message?: string
}

/** What to burn: local paths and/or remote copyparty files (downloaded first). */
export interface BurnSources {
  local: string[]
  remote: { server: string; items: { vpath: string; name: string }[] } | null
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  mtime: number
  hidden: boolean
}

export interface ListResult {
  cwd: string
  parent: string | null
  entries: FileEntry[]
}

export interface RemoteEntry {
  name: string
  href: string
  size: number
  ts: number
  isDirectory: boolean
  tags?: Record<string, unknown>
}

export interface RemoteListResult {
  vpath: string
  parent: string | null
  entries: RemoteEntry[]
  perms: string[]
  acct?: string
  srvinf?: string
}

export interface ConnectResult {
  ok: boolean
  status: number
  acct?: string
  message?: string
}

export interface FsSearchHit {
  name: string
  path: string
  relPath: string
  isDirectory: boolean
  size: number
  mtime: number
}

export interface FsSearchResult {
  hits: FsSearchHit[]
  truncated: boolean
}

export interface CppSearchHit {
  name: string
  vpath: string
  isDirectory: boolean
  size: number
  ts: number
}

export interface CppSearchResult {
  hits: CppSearchHit[]
  truncated: boolean
}

export interface ShareResult {
  ok: boolean
  url?: string
  key?: string
  expiresAt?: number
  files?: number
  bytes?: number
  /** false when the selection includes a folder -- `bytes` then only sums the known file sizes, not the folder's contents. */
  bytesKnown?: boolean
  error?: string
}

export const IpcChannels = {
  DrivesList: 'drives:list',
  DriveAdded: 'drive:added',
  DriveRemoved: 'drive:removed',
  DriveChanged: 'drive:changed',
  FsList: 'fs:list',
  FsHome: 'fs:home',
  FsThumb: 'fs:thumb',
  FsSearch: 'fs:search',
  CppConnect: 'cpp:connect',
  CppList: 'cpp:list',
  CppDisconnect: 'cpp:disconnect',
  CppConnections: 'cpp:connections',
  CppUpload: 'cpp:upload',
  CppDownload: 'cpp:download',
  CppProgress: 'cpp:progress',
  CppThumb: 'cpp:thumb',
  CppSearch: 'cpp:search',
  CppShare: 'cpp:share',
  BurnStart: 'burn:start',
  BurnProgress: 'burn:progress',
  BurnAvailable: 'burn:available',
  DvdRipAvailable: 'dvdrip:available',
  DvdRipIsVideoDvd: 'dvdrip:is-video-dvd',
  DvdRipStart: 'dvdrip:start',
  DvdRipProgress: 'dvdrip:progress',
  CdRipAvailable: 'cdrip:available',
  CdRipStart: 'cdrip:start',
  CdRipProgress: 'cdrip:progress',
  PreviewMetadata: 'preview:metadata',
  PreviewMetadataWrite: 'preview:metadata:write',
  PreviewReadText: 'preview:read-text',
  PreviewIcon: 'preview:icon',
  PreviewConvert: 'preview:convert',
  PreviewReadBytes: 'preview:read-bytes',
  AgoraStats: 'agora:stats',
  AgoraRole: 'agora:role',
  AgoraReset: 'agora:reset',
  ConfigGetHost: 'config:get-host',
  ConfigSetHost: 'config:set-host',
  ConfigScanHosts: 'config:scan-hosts',
  ConfigAdminPwSet: 'config:admin-pw-set'
} as const

export interface AgoraStats {
  enabled: boolean
  session: { id: number; started_at: number; uptime_s: number } | null
  live: number
  ever: number
  peak_live: number
  traffic_bytes: number | null
  updated_at: number | null
  stale_s: number | null
  history: { ts: number; live: number }[]
  // Kiosk-reported event counters (optional: older server versions omit them).
  usb_count?: number
  disc_count?: number
  files_transferred?: number
  bytes_transferred?: number
  by_ext?: { ext: string; count: number; bytes: number }[]
  qr_shares?: number
  qr_bytes?: number
}

/** Event a kiosk reports to the agora dashboard (fire-and-forget). */
export type AgoraEvent =
  | { kind: 'usb_connected'; kiosk: string }
  | { kind: 'disc_inserted'; kiosk: string }
  | {
      kind: 'transfer'
      kiosk: string
      direction: 'up' | 'down'
      files: number
      bytes: number
      exts: Record<string, { count: number; bytes: number }>
    }
  | {
      kind: 'qr_share'
      kiosk: string
      files: number
      bytes: number
      exts: Record<string, { count: number; bytes: number }>
    }

export type AgoraStatsResult =
  | { ok: true; stats: AgoraStats }
  | { ok: false; error: string }

/** local role of this kiosk, read from ~/.agora/role (main vs client). */
export interface AgoraRole {
  isMain: boolean
}

export type AgoraResetResult =
  | { ok: true; session: number }
  | { ok: false; error: string }

/** A host on the LAN that answered on the copyparty port during a scan. */
export interface AgoraHostCandidate {
  ip: string
  /** Reverse-resolved name (mDNS/DNS) if available, else null. */
  name: string | null
}

export type UploadProgress =
  | { kind: 'hash'; name: string; bytesDone: number; bytesTotal: number }
  | {
      kind: 'upload'
      name: string
      bytesDone: number
      bytesTotal: number
      chunkIndex: number
      chunkCount: number
    }
  | { kind: 'retry'; name: string; attempt: number; reason: string }
  | { kind: 'done'; name: string; bytesTotal: number }
  | { kind: 'error'; name: string; message: string }

export interface TransferResult {
  ok: boolean
  message?: string
  done: number
  total: number
}

export type PreviewSource =
  | { kind: 'local'; path: string }
  | { kind: 'remote'; server: string; vpath: string }

export interface FileMetadata {
  writable: boolean
  common: {
    title?: string
    comment?: string
    author?: string
    dimensions?: string // "4032×3024"
    duration?: number // Sekunden
    dateTaken?: string // ISO
  }
  raw: Record<string, string | number> // exiftool-Rohfelder bzw. copyparty-Tags, flach
}

export interface MetadataWriteResult {
  ok: boolean
  message?: string
}

export interface ReadTextResult {
  text: string
  truncated: boolean
  error?: string
}

export type PreviewConvertResult =
  | { ok: true; cacheKey: string }
  | { ok: false; error: string }

export type DvdRipProgress =
  | { kind: 'scan' }
  | { kind: 'encode'; percent: number }
  | { kind: 'upload'; percent: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export interface DvdRipResult {
  ok: boolean
  message?: string
}

export type CdRipProgress =
  | { kind: 'scan' }
  | { kind: 'rip'; track: number; total: number; percent: number }
  | { kind: 'encode'; track: number; total: number }
  | { kind: 'upload'; percent: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export interface CdRipResult {
  ok: boolean
  message?: string
}
