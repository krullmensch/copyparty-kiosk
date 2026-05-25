import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve, parse } from 'node:path'
import { homedir } from 'node:os'
import { FileEntry, IpcChannels, ListResult } from '../../shared/types'

async function toEntry(cwd: string, name: string): Promise<FileEntry | null> {
  const full = join(cwd, name)
  try {
    const lst = await fs.lstat(full)
    const isSymlink = lst.isSymbolicLink()
    let isDirectory = lst.isDirectory()
    let size = lst.size
    let mtime = lst.mtimeMs

    if (isSymlink) {
      try {
        const st = await fs.stat(full)
        isDirectory = st.isDirectory()
        size = st.size
        mtime = st.mtimeMs
      } catch {
        // dangling symlink — keep lstat info
      }
    }

    return {
      name,
      path: full,
      isDirectory,
      isSymlink,
      size,
      mtime,
      hidden: name.startsWith('.')
    }
  } catch {
    return null
  }
}

async function listDir(input: string): Promise<ListResult> {
  const cwd = resolve(input)
  const names = await fs.readdir(cwd)
  const entries = (await Promise.all(names.map((n) => toEntry(cwd, n)))).filter(
    (e): e is FileEntry => e !== null
  )

  const parentDir = dirname(cwd)
  const isRoot = parse(cwd).root === cwd
  return {
    cwd,
    parent: isRoot ? null : parentDir,
    entries
  }
}

export function registerFsIpc(): void {
  ipcMain.handle(IpcChannels.FsList, async (_, path: string): Promise<ListResult> => {
    return listDir(path)
  })
  ipcMain.handle(IpcChannels.FsHome, async (): Promise<string> => homedir())
}
