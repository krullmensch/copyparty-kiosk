import { BrowserWindow, ipcMain } from 'electron'
import drivelist from 'drivelist'
import { DriveInfo, IpcChannels } from '../../shared/types'
import { dropBucket, setKnownMounts } from '../thumb-cache'
import { reportDiscInserted, reportUsbConnected } from '../agora-events'

const POLL_INTERVAL_MS = 2000

let pollTimer: NodeJS.Timeout | null = null
let lastDrives: Map<string, DriveInfo> = new Map()
// false until the first poll completed; that first snapshot is the baseline
// and fires no agora events (see tick()).
let baselined = false

/**
 * Optical drive detection. drivelist has no isOptical flag, so key off the
 * Linux SCSI CD-ROM node (/dev/sr*) or a CD/DVD/BD hint in the description.
 * USB DVD writers show up as /dev/sr0 with busType USB.
 */
function isOpticalDrive(d: drivelist.Drive): boolean {
  if (/^\/dev\/sr\d+$/.test(d.device)) return true
  const desc = (d.description ?? '').toLowerCase()
  return /\b(dvd|cd-?rom|blu-?ray|bd-?re|optical)\b/.test(desc)
}

function toDriveInfo(d: drivelist.Drive): DriveInfo {
  return {
    id: d.device,
    device: d.device,
    description: d.description,
    size: d.size,
    isUSB: !!d.isUSB,
    isRemovable: !!d.isRemovable,
    isSystem: !!d.isSystem,
    isOptical: isOpticalDrive(d),
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
    .filter(
      (d) =>
        !d.isSystem && (d.isUSB || d.isRemovable || isOpticalDrive(d)) && !isBackupVolume(d)
    )
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
    // Agora dashboard events (fire-and-forget; dashboard may be offline). A USB
    // drive fires on first appearance. An optical drive fires disc_inserted when
    // it gains its first mountpoint — either appearing already-mounted, or
    // transitioning no-mountpoint -> mountpoint on a drive we already track.
    // The very first tick is the baseline: drives already plugged in when the
    // app starts are not "newly connected" and must not be counted (otherwise
    // every app restart re-counts them).
    if (!baselined) {
      baselined = true
    } else {
      for (const d of current) {
        const prev = lastDrives.get(d.id)
        if (!prev) {
          if (!d.isOptical) reportUsbConnected()
          else if (d.mountpoints.length > 0) reportDiscInserted()
        } else if (d.isOptical && prev.mountpoints.length === 0 && d.mountpoints.length > 0) {
          reportDiscInserted()
        }
      }
    }
    lastDrives = new Map(current.map((d) => [d.id, d]))
    const mounts: string[] = []
    for (const d of current) for (const m of d.mountpoints) mounts.push(m.path)
    setKnownMounts(mounts)
  } catch (err) {
    console.error('[drives] poll failed:', err)
  }
}

/**
 * Mountpoints of the currently-detected drives, read from the poll snapshot.
 * Used by the kiosk-stream:// local route to allow-list served paths.
 */
export function getCurrentMountpoints(): string[] {
  const mounts: string[] = []
  for (const d of lastDrives.values()) for (const m of d.mountpoints) mounts.push(m.path)
  return mounts
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
