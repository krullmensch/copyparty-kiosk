import { useEffect } from 'react'
import { gooeyToast } from 'goey-toast'
import type { UploadProgress } from '../../../shared/types'

function pct(done: number, total: number): number {
  if (!total) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

export function useUploadProgress(): void {
  useEffect(() => {
    const active = new Map<string, string | number>()

    const unsub = window.api.cpp.onProgress((p: UploadProgress) => {
      const id = active.get(p.name)

      if (p.kind === 'hash') {
        const desc = `${pct(p.bytesDone, p.bytesTotal)}%`
        if (id == null) {
          const newId = gooeyToast(`Hashing ${p.name}`, {
            description: desc,
            duration: Infinity,
            showProgress: false
          })
          active.set(p.name, newId)
        } else {
          gooeyToast.update(id, { title: `Hashing ${p.name}`, description: desc })
        }
        return
      }

      if (p.kind === 'upload') {
        const desc = `${pct(p.bytesDone, p.bytesTotal)}%`
        if (id == null) {
          const newId = gooeyToast(`Uploading ${p.name}`, {
            description: desc,
            duration: Infinity
          })
          active.set(p.name, newId)
        } else {
          gooeyToast.update(id, { title: `Uploading ${p.name}`, description: desc })
        }
        return
      }

      if (p.kind === 'retry') {
        const desc = `Reconnecting… (attempt ${p.attempt})`
        if (id != null) gooeyToast.update(id, { description: desc })
        return
      }

      if (p.kind === 'done') {
        if (id != null) gooeyToast.dismiss(id)
        active.delete(p.name)
        gooeyToast.success(`Uploaded ${p.name}`, { duration: 4000 })
        return
      }

      if (p.kind === 'error') {
        if (id != null) gooeyToast.dismiss(id)
        active.delete(p.name)
        gooeyToast.error(`Failed ${p.name}`, { description: p.message, duration: 8000 })
      }
    })

    return () => {
      unsub()
    }
  }, [])
}
