import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveInfo } from '../../shared/types'

// drives.ts imports drivelist, execFile, and sends IPC events to BrowserWindow.
// parseOpticalLsblk is a pure JSON parser, so stub everything that's Electron-only.
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() }
}))
vi.mock('drivelist', () => ({
  default: { list: vi.fn() }
}))

const execFileMock = vi.fn(
  (
    _file: string,
    _args: string[],
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => {
    callback(new Error('lsblk not found'))
  }
)
vi.mock('node:child_process', () => ({
  execFile: execFileMock
}))

const { parseOpticalLsblk, listOpticalDrives, isBackupDriveInfo, diff, parseUdevMedia } =
  await import('./drives')

function opticalDrive(mountpoint: string | null): DriveInfo {
  return {
    id: '/dev/sr0',
    device: '/dev/sr0',
    description: 'DVD',
    size: null,
    isUSB: false,
    isRemovable: true,
    isSystem: false,
    isOptical: true,
    mountpoints: mountpoint ? [{ path: mountpoint, label: 'JURASSIC_WORLD' }] : []
  }
}

describe('parseOpticalLsblk', () => {
  // Case 1: Data disc with label, mounted (kiosk2 real fixture)
  it('parses a mounted data disc with label', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sr0',
          path: '/dev/sr0',
          label: 'Bläserklasse',
          mountpoint: '/media/marvin/Bläserklasse',
          ro: false,
          rm: true,
          type: 'rom',
          model: 'DVD RW AD-7710H'
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result).toHaveLength(1)
    const drive = result[0]
    expect(drive.device).toBe('/dev/sr0')
    expect(drive.isOptical).toBe(true)
    expect(drive.isRemovable).toBe(true)
    expect(drive.isUSB).toBe(false)
    expect(drive.isSystem).toBe(false)
    expect(drive.description).toBe('DVD RW AD-7710H')
    expect(drive.mountpoints).toEqual([
      { path: '/media/marvin/Bläserklasse', label: 'Bläserklasse' }
    ])
  })

  // Case 2: Blank disc with no label/mountpoint (burn target)
  it('parses a blank disc without label or mountpoint', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sr0',
          path: '/dev/sr0',
          label: null,
          mountpoint: null,
          ro: false,
          rm: true,
          type: 'rom',
          model: 'DVD RW AD-7710H'
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result).toHaveLength(1)
    const drive = result[0]
    expect(drive.device).toBe('/dev/sr0')
    expect(drive.isOptical).toBe(true)
    expect(drive.description).toBe('DVD RW AD-7710H')
    expect(drive.mountpoints).toEqual([])
  })

  // Case 3: Empty model field falls back to 'Optical Drive'
  it('falls back to "Optical Drive" when model is empty', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sr0',
          path: '/dev/sr0',
          label: null,
          mountpoint: null,
          ro: false,
          rm: true,
          type: 'rom',
          model: null
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('Optical Drive')
  })

  // Case 4: No rom device in blockdevices returns empty array
  it('returns empty array when no type==="rom" device is present', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          path: '/dev/sda',
          label: null,
          mountpoint: null,
          ro: false,
          rm: false,
          type: 'disk',
          model: 'Samsung SSD'
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result).toEqual([])
  })

  // Case 5: Mix of rom and non-rom devices (only rom included)
  it('filters out non-rom devices and returns only rom devices', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sda',
          path: '/dev/sda',
          label: null,
          mountpoint: '/media/marvin/usb',
          ro: false,
          rm: true,
          type: 'disk',
          model: 'USB Stick'
        },
        {
          name: 'sr0',
          path: '/dev/sr0',
          label: 'MyDVD',
          mountpoint: '/media/marvin/MyDVD',
          ro: true,
          rm: true,
          type: 'rom',
          model: 'DVD Reader'
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result).toHaveLength(1)
    expect(result[0].device).toBe('/dev/sr0')
    expect(result[0].description).toBe('DVD Reader')
  })

  // Case 6: Unparseable JSON (empty string, malformed JSON) returns empty array
  it('returns empty array for unparseable JSON', () => {
    expect(parseOpticalLsblk('')).toEqual([])
    expect(parseOpticalLsblk('not json')).toEqual([])
    expect(parseOpticalLsblk('{ invalid json')).toEqual([])
    expect(parseOpticalLsblk('null')).toEqual([])
  })

  // Additional: Verify id field matches device
  it('sets id to match device path', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sr1',
          path: '/dev/sr1',
          label: null,
          mountpoint: null,
          ro: false,
          rm: true,
          type: 'rom',
          model: 'DVD'
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result[0].id).toBe('/dev/sr1')
    expect(result[0].device).toBe('/dev/sr1')
  })

  // Additional: Verify size is always null for optical drives
  it('sets size to null for optical drives', () => {
    const stdout = JSON.stringify({
      blockdevices: [
        {
          name: 'sr0',
          path: '/dev/sr0',
          label: 'Test',
          mountpoint: '/media/test',
          ro: false,
          rm: true,
          type: 'rom',
          model: 'DVD'
        }
      ]
    })

    const result = parseOpticalLsblk(stdout)
    expect(result[0].size).toBeNull()
  })
})

describe('listOpticalDrives', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    execFileMock.mockClear()
  })

  it('returns [] when lsblk execFile fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const result = await listOpticalDrives()
    expect(result).toEqual([])
  })

  it('returns [] on non-linux platform without calling execFile', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const result = await listOpticalDrives()
    expect(result).toEqual([])
    expect(execFileMock).not.toHaveBeenCalled()
  })
})

describe('isBackupDriveInfo', () => {
  it('returns true for a drive with a "Backup" label', () => {
    expect(
      isBackupDriveInfo({
        id: '/dev/sr0',
        device: '/dev/sr0',
        description: 'DVD',
        size: null,
        isUSB: false,
        isRemovable: true,
        isSystem: false,
        isOptical: true,
        mountpoints: [{ path: '/media/marvin/Backup', label: 'Backup' }]
      })
    ).toBe(true)
  })

  it('returns false for a normally-labeled drive', () => {
    expect(
      isBackupDriveInfo({
        id: '/dev/sr0',
        device: '/dev/sr0',
        description: 'DVD',
        size: null,
        isUSB: false,
        isRemovable: true,
        isSystem: false,
        isOptical: true,
        mountpoints: [{ path: '/media/marvin/MyDVD', label: 'MyDVD' }]
      })
    ).toBe(false)
  })
})

describe('diff — optical disc in/out on a persistent /dev/sr0 node', () => {
  // The optical device node stays enumerated whether or not a disc is present;
  // only its mountpoint changes. These transitions must surface as `changed`,
  // not be swallowed because the device id is unchanged.
  it('reports disc insertion (mountpoint gained) as changed, not added/removed', () => {
    const prev = new Map([['/dev/sr0', opticalDrive(null)]])
    const { added, removed, changed } = diff(prev, [opticalDrive('/media/marvin/JURASSIC_WORLD')])
    expect(added).toEqual([])
    expect(removed).toEqual([])
    expect(changed).toHaveLength(1)
    expect(changed[0].mountpoints[0].path).toBe('/media/marvin/JURASSIC_WORLD')
  })

  it('reports disc removal (mountpoint lost) as changed, not removed', () => {
    const prev = new Map([['/dev/sr0', opticalDrive('/media/marvin/JURASSIC_WORLD')]])
    const { added, removed, changed } = diff(prev, [opticalDrive(null)])
    expect(added).toEqual([])
    expect(removed).toEqual([])
    expect(changed).toHaveLength(1)
    expect(changed[0].mountpoints).toEqual([])
  })

  it('reports no change when the mountpoint is stable', () => {
    const drive = opticalDrive('/media/marvin/JURASSIC_WORLD')
    const prev = new Map([['/dev/sr0', drive]])
    const { added, removed, changed } = diff(prev, [opticalDrive('/media/marvin/JURASSIC_WORLD')])
    expect(added).toEqual([])
    expect(removed).toEqual([])
    expect(changed).toEqual([])
  })

  it('still reports a genuinely new device as added', () => {
    const { added, changed } = diff(new Map(), [opticalDrive('/media/marvin/JURASSIC_WORLD')])
    expect(added).toHaveLength(1)
    expect(changed).toEqual([])
  })
})

describe('parseUdevMedia — disc loaded vs empty tray', () => {
  // Real udev output: a loaded DVD (kiosk3 fixture) vs an empty drive (kiosk2).
  it('detects a loaded disc via ID_CDROM_MEDIA=1', () => {
    const loaded = [
      'ID_CDROM=1',
      'ID_CDROM_MEDIA=1',
      'ID_CDROM_MEDIA_DVD=1',
      'ID_CDROM_MEDIA_STATE=complete',
      'ID_FS_TYPE=udf'
    ].join('\n')
    expect(parseUdevMedia(loaded)).toBe(true)
  })

  it('reports no media for an empty drive (ID_CDROM only)', () => {
    expect(parseUdevMedia('ID_CDROM=1')).toBe(false)
  })

  it('does not match ID_CDROM_MEDIA as a substring of another key', () => {
    // ID_CDROM_MEDIA_DVD=1 without ID_CDROM_MEDIA=1 must not count as media.
    expect(parseUdevMedia('ID_CDROM=1\nID_CDROM_MEDIA_DVD=1')).toBe(false)
  })
})
