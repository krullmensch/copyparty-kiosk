import { useState } from 'react'
import { Disc } from 'lucide-react'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'
import type { BurnSources, DriveInfo } from '../../../shared/types'
import { BurnDialog } from './BurnDialog'

/**
 * Burn target for an optical drive: drop local (USB) or remote (Agora) files
 * here to burn them to DVD. Remote files are downloaded to a temp dir first
 * (handled in the main process).
 */
export function OpticalDropZone({ drive }: { drive: DriveInfo }): React.JSX.Element {
  const [over, setOver] = useState(false)
  const [sources, setSources] = useState<BurnSources | null>(null)

  const accepts = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(DRAG_MIME)

  const onDragOver = (e: React.DragEvent): void => {
    if (!accepts(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setOver(true)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const payload = JSON.parse(raw) as DragPayload
    if (payload.kind === 'local') {
      if (payload.paths.length === 0) return
      setSources({ local: payload.paths, remote: null })
    } else {
      if (payload.vpaths.length === 0) return
      const items = payload.vpaths.map((vp, i) => ({ vpath: vp, name: payload.names[i] }))
      setSources({ local: [], remote: { server: payload.server, items } })
    }
  }

  const discLabel = drive.mountpoints[0]?.label ?? null

  return (
    <>
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`border-border text-ink-muted flex items-center justify-center gap-2 rounded-md border border-dashed px-4 py-2 text-meta transition-colors ${
          over ? 'border-primary bg-primary/10 text-foreground' : ''
        }`}
      >
        <Disc className="size-4" strokeWidth={1.5} />
        <span>
          {drive.description || 'DVD-Laufwerk'}
          {discLabel ? ` · ${discLabel}` : ''} — Dateien hierher ziehen zum Brennen
        </span>
      </div>
      {sources && (
        <BurnDialog device={drive.device} sources={sources} onClose={() => setSources(null)} />
      )}
    </>
  )
}
