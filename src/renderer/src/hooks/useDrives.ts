import { useEffect, useState } from 'react'
import type { DriveInfo } from '../../../shared/types'

export function useDrives(): DriveInfo[] {
  const [drives, setDrives] = useState<DriveInfo[]>([])

  useEffect(() => {
    let cancelled = false

    window.api.drives.list().then((initial) => {
      if (!cancelled) setDrives(initial)
    })

    const offAdded = window.api.drives.onAdded((drive) => {
      setDrives((prev) => (prev.find((d) => d.id === drive.id) ? prev : [...prev, drive]))
    })
    const offRemoved = window.api.drives.onRemoved((id) => {
      setDrives((prev) => prev.filter((d) => d.id !== id))
    })

    return () => {
      cancelled = true
      offAdded()
      offRemoved()
    }
  }, [])

  return drives
}
