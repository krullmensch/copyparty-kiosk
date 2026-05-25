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

export const IpcChannels = {
  DrivesList: 'drives:list',
  DriveAdded: 'drive:added',
  DriveRemoved: 'drive:removed',
  FsList: 'fs:list',
  FsHome: 'fs:home',
  CppConnect: 'cpp:connect',
  CppList: 'cpp:list',
  CppDisconnect: 'cpp:disconnect',
  CppConnections: 'cpp:connections',
  CppUpload: 'cpp:upload',
  CppDownload: 'cpp:download',
  CppProgress: 'cpp:progress'
} as const

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
  | { kind: 'done'; name: string; bytesTotal: number }
  | { kind: 'error'; name: string; message: string }

export interface TransferResult {
  ok: boolean
  message?: string
  done: number
  total: number
}
