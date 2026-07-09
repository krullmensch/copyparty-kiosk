import { useState } from 'react'
import { Disc } from 'lucide-react'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'
import type { DriveInfo } from '../../../shared/types'
import { gooeyToast as toast } from 'goey-toast'
import { BurnDialog } from './BurnDialog'

/**
 * Burn target for an optical drive: drop local files here to burn them to DVD.
 * Remote (Agora) files aren't burnable directly yet — they'd need downloading
 * first.
 */
export function OpticalDropZone({ drive }: { drive: DriveInfo }): React.JSX.Element {
  const [over, setOver] = useState(false)
  const [items, setItems] = useState<string[] | null>(null)

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
    if (payload.kind !== 'local') {
      toast.error('Nur lokale Dateien können gebrannt werden')
      return
    }
    if (payload.paths.length === 0) return
    setItems(payload.paths)
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
      {items && (
        <BurnDialog device={drive.device} items={items} onClose={() => setItems(null)} />
      )}
    </>
  )
}
