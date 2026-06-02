import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, parse } from 'node:path'
import { homedir } from 'node:os'
import { FileEntry, FsSearchHit, FsSearchResult, IpcChannels, ListResult } from '../../shared/types'
import { getThumb } from '../thumb-cache'

const SEARCH_LIMIT = 500
const SEARCH_TIMEOUT_MS = 8000
const IGNORE_DIRS = new Set(['.Trash-1000', '.Spotlight-V100', '.fseventsd', 'System Volume Information', '$RECYCLE.BIN', 'node_modules', '.git'])

async function walk(
  dir: string,
  query: string,
  hits: FsSearchHit[],
  deadline: number
): Promise<boolean> {
  if (hits.length >= SEARCH_LIMIT) return true
  if (Date.now() > deadline) return true
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return false
  }
  for (const name of names) {
    if (hits.length >= SEARCH_LIMIT) return true
    if (Date.now() > deadline) return true
    if (IGNORE_DIRS.has(name)) continue
    const full = join(dir, name)
    let st: import('node:fs').Stats
    try {
      st = await fs.lstat(full)
    } catch {
      continue
    }
    const isDir = st.isDirectory()
    if (name.toLowerCase().includes(query)) {
      hits.push({
        name,
        path: full,
        relPath: '',
        isDirectory: isDir,
        size: st.size,
        mtime: st.mtimeMs
      })
    }
    if (isDir && !st.isSymbolicLink()) {
      const truncated = await walk(full, query, hits, deadline)
      if (truncated) return true
    }
  }
  return false
}

async function searchRoot(root: string, query: string): Promise<FsSearchResult> {
  const q = query.trim().toLowerCase()
  if (!q) return { hits: [], truncated: false }
  const deadline = Date.now() + SEARCH_TIMEOUT_MS
  const hits: FsSearchHit[] = []
  const truncated = await walk(root, q, hits, deadline)
  for (const h of hits) h.relPath = relative(root, h.path) || h.name
  return { hits, truncated: truncated || hits.length >= SEARCH_LIMIT }
}

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
  ipcMain.handle(IpcChannels.FsThumb, async (_, path: string): Promise<string | null> =>
    getThumb(path)
  )
  ipcMain.handle(
    IpcChannels.FsSearch,
    async (_, root: string, query: string): Promise<FsSearchResult> => searchRoot(root, query)
  )
}
