import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  ConnectResult,
  DriveInfo,
  IpcChannels,
  ListResult,
  RemoteListResult,
  TransferResult,
  UploadProgress
} from '../shared/types'

const api = {
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
    home: (): Promise<string> => ipcRenderer.invoke(IpcChannels.FsHome)
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
    onProgress: (cb: (p: UploadProgress) => void): (() => void) => {
      const handler = (_: unknown, p: UploadProgress): void => cb(p)
      ipcRenderer.on(IpcChannels.CppProgress, handler)
      return () => ipcRenderer.off(IpcChannels.CppProgress, handler)
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
