import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  AgoraResetResult,
  AgoraRole,
  AgoraStatsResult,
  BurnProgress,
  BurnResult,
  BurnSources,
  ConnectResult,
  CppSearchResult,
  DriveInfo,
  DvdRipProgress,
  DvdRipResult,
  FileMetadata,
  FsSearchResult,
  FsWriteResult,
  IpcChannels,
  ListResult,
  MetadataWriteResult,
  PreviewConvertResult,
  PreviewSource,
  ReadTextResult,
  RemoteListResult,
  TransferResult,
  UploadProgress
} from '../shared/types'

// Loopback media server base (http://127.0.0.1:PORT), read once synchronously.
const mediaBase: string = ipcRenderer.sendSync('get-media-base')

const api = {
  mediaBase,
  drives: {
    list: (): Promise<DriveInfo[]> => ipcRenderer.invoke(IpcChannels.DrivesList),
    onAdded: (cb: (drive: DriveInfo) => void): (() => void) => {
      const handler = (_: unknown, drive: DriveInfo): void => cb(drive)
      ipcRenderer.on(IpcChannels.DriveAdded, handler)
      return () => ipcRenderer.off(IpcChannels.DriveAdded, handler)
    },
    onRemoved: (cb: (id: string) => void): (() => void) => {
      const handler = (_: unknown, id: string): void => cb(id)
      ipcRenderer.on(IpcChannels.DriveRemoved, handler)
      return () => ipcRenderer.off(IpcChannels.DriveRemoved, handler)
    }
  },
  fs: {
    list: (path: string): Promise<ListResult> => ipcRenderer.invoke(IpcChannels.FsList, path),
    home: (): Promise<string> => ipcRenderer.invoke(IpcChannels.FsHome),
    thumb: (path: string): Promise<string | null> => ipcRenderer.invoke(IpcChannels.FsThumb, path),
    search: (root: string, query: string): Promise<FsSearchResult> =>
      ipcRenderer.invoke(IpcChannels.FsSearch, root, query),
    write: (path: string, content: string): Promise<FsWriteResult> =>
      ipcRenderer.invoke(IpcChannels.FsWrite, path, content)
  },
  cpp: {
    connect: (url: string, password?: string): Promise<ConnectResult> =>
      ipcRenderer.invoke(IpcChannels.CppConnect, url, password),
    list: (url: string, vpath: string): Promise<RemoteListResult> =>
      ipcRenderer.invoke(IpcChannels.CppList, url, vpath),
    disconnect: (url: string): Promise<void> => ipcRenderer.invoke(IpcChannels.CppDisconnect, url),
    connections: (): Promise<string[]> => ipcRenderer.invoke(IpcChannels.CppConnections),
    upload: (url: string, targetVpath: string, localPaths: string[]): Promise<TransferResult> =>
      ipcRenderer.invoke(IpcChannels.CppUpload, url, targetVpath, localPaths),
    download: (
      url: string,
      targetDir: string,
      items: { vpath: string; name: string }[]
    ): Promise<TransferResult> =>
      ipcRenderer.invoke(IpcChannels.CppDownload, url, targetDir, items),
    thumb: (url: string, vpath: string): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.CppThumb, url, vpath),
    search: (url: string, query: string): Promise<CppSearchResult> =>
      ipcRenderer.invoke(IpcChannels.CppSearch, url, query),
    write: (url: string, vpath: string, content: string): Promise<FsWriteResult> =>
      ipcRenderer.invoke(IpcChannels.CppWrite, url, vpath, content),
    onProgress: (cb: (p: UploadProgress) => void): (() => void) => {
      const handler = (_: unknown, p: UploadProgress): void => cb(p)
      ipcRenderer.on(IpcChannels.CppProgress, handler)
      return () => ipcRenderer.off(IpcChannels.CppProgress, handler)
    }
  },
  agora: {
    stats: (): Promise<AgoraStatsResult> => ipcRenderer.invoke(IpcChannels.AgoraStats),
    role: (): Promise<AgoraRole> => ipcRenderer.invoke(IpcChannels.AgoraRole),
    reset: (password: string): Promise<AgoraResetResult> =>
      ipcRenderer.invoke(IpcChannels.AgoraReset, password)
  },
  preview: {
    metadata: (source: PreviewSource): Promise<FileMetadata> =>
      ipcRenderer.invoke(IpcChannels.PreviewMetadata, source),
    writeMetadata: (
      source: PreviewSource,
      patch: Partial<FileMetadata['common']>
    ): Promise<MetadataWriteResult> =>
      ipcRenderer.invoke(IpcChannels.PreviewMetadataWrite, source, patch),
    readText: (source: PreviewSource, maxBytes: number): Promise<ReadTextResult> =>
      ipcRenderer.invoke(IpcChannels.PreviewReadText, source, maxBytes),
    icon: (source: PreviewSource): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannels.PreviewIcon, source),
    convert: (source: PreviewSource): Promise<PreviewConvertResult> =>
      ipcRenderer.invoke(IpcChannels.PreviewConvert, source),
    readBytes: (source: PreviewSource): Promise<Uint8Array | null> =>
      ipcRenderer.invoke(IpcChannels.PreviewReadBytes, source)
  },
  burn: {
    available: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.BurnAvailable),
    start: (device: string, sources: BurnSources, label: string): Promise<BurnResult> =>
      ipcRenderer.invoke(IpcChannels.BurnStart, device, sources, label),
    onProgress: (cb: (p: BurnProgress) => void): (() => void) => {
      const handler = (_: unknown, p: BurnProgress): void => cb(p)
      ipcRenderer.on(IpcChannels.BurnProgress, handler)
      return () => ipcRenderer.off(IpcChannels.BurnProgress, handler)
    }
  },
  dvdrip: {
    available: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.DvdRipAvailable),
    isVideoDvd: (mountPath: string): Promise<boolean> =>
      ipcRenderer.invoke(IpcChannels.DvdRipIsVideoDvd, mountPath),
    start: (mountPath: string, label: string, server: string): Promise<DvdRipResult> =>
      ipcRenderer.invoke(IpcChannels.DvdRipStart, mountPath, label, server),
    onProgress: (cb: (p: DvdRipProgress) => void): (() => void) => {
      const handler = (_: unknown, p: DvdRipProgress): void => cb(p)
      ipcRenderer.on(IpcChannels.DvdRipProgress, handler)
      return () => ipcRenderer.off(IpcChannels.DvdRipProgress, handler)
    }
  }
}

export type AppApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
