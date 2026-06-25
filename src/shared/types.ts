export interface DriveInfo {
  id: string
  device: string
  description: string
  size: number | null
  isUSB: boolean
  isRemovable: boolean
  isSystem: boolean
  mountpoints: { path: string; label?: string | null }[]
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

export const IpcChannels = {
  DrivesList: 'drives:list',
  DriveAdded: 'drive:added',
  DriveRemoved: 'drive:removed',
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
  AgoraStats: 'agora:stats',
  AgoraRole: 'agora:role',
  AgoraReset: 'agora:reset'
} as const

export interface AgoraStats {
  enabled: boolean
  session: { id: number; started_at: number; uptime_s: number } | null
  live: number
  ever: number
  peak_live: number
  wlan_bytes: number | null
  updated_at: number | null
  stale_s: number | null
  history: { ts: number; live: number }[]
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
