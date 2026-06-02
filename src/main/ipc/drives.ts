import { BrowserWindow, ipcMain } from 'electron'
import drivelist from 'drivelist'
import { DriveInfo, IpcChannels } from '../../shared/types'
import { dropBucket, setKnownMounts } from '../thumb-cache'

const POLL_INTERVAL_MS = 2000

let pollTimer: NodeJS.Timeout | null = null
let lastDrives: Map<string, DriveInfo> = new Map()

function toDriveInfo(d: drivelist.Drive): DriveInfo {
  return {
    id: d.device,
    device: d.device,
    description: d.description,
    size: d.size,
    isUSB: !!d.isUSB,
    isRemovable: !!d.isRemovable,
    isSystem: !!d.isSystem,
    mountpoints: d.mountpoints.map((m) => ({ path: m.path, label: m.label }))
  }
}

function isBackupVolume(d: drivelist.Drive): boolean {
  return d.mountpoints.some((m) => {
    const label = m.label ?? ''
    const tail = m.path.split(/[\\/]/).filter(Boolean).pop() ?? ''
    return /^backup/i.test(label) || /^backup/i.test(tail)
  })
}

async function snapshot(): Promise<DriveInfo[]> {
  const drives = await drivelist.list()
  return drives
    .filter((d) => !d.isSystem && (d.isUSB || d.isRemovable) && !isBackupVolume(d))
    .map(toDriveInfo)
}

function diff(prev: Map<string, DriveInfo>, next: DriveInfo[]): {
  added: DriveInfo[]
  removed: string[]
} {
  const nextIds = new Set(next.map((d) => d.id))
  const added = next.filter((d) => !prev.has(d.id))
  const removed = [...prev.keys()].filter((id) => !nextIds.has(id))
  return { added, removed }
}

async function tick(window: BrowserWindow): Promise<void> {
  try {
    const current = await snapshot()
    const { added, removed } = diff(lastDrives, current)
    for (const d of added) window.webContents.send(IpcChannels.DriveAdded, d)
    for (const id of removed) {
      const gone = lastDrives.get(id)
      if (gone) {
        for (const m of gone.mountpoints) {
          void dropBucket(m.path)
        }
      }
      window.webContents.send(IpcChannels.DriveRemoved, id)
    }
    lastDrives = new Map(current.map((d) => [d.id, d]))
    const mounts: string[] = []
    for (const d of current) for (const m of d.mountpoints) mounts.push(m.path)
    setKnownMounts(mounts)
  } catch (err) {
    console.error('[drives] poll failed:', err)
  }
}

export function registerDrivesIpc(window: BrowserWindow): void {
  ipcMain.handle(IpcChannels.DrivesList, async () => snapshot())

  if (pollTimer) clearInterval(pollTimer)
  void tick(window)
  pollTimer = setInterval(() => void tick(window), POLL_INTERVAL_MS)

  window.on('closed', () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })
}
