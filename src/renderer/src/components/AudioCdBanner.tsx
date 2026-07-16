import { useState } from 'react'
import { Disc } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DriveInfo } from '../../../shared/types'
import { CdRipDialog } from './CdRipDialog'

/**
 * Shown when the inserted disc is an audio CD (CDDA, no mountpoint). Offers
 * ripping all tracks to FLAC on Agora.
 */
export function AudioCdBanner({
  drive,
  server
}: {
  drive: DriveInfo
  server: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="border-border bg-bg-page-tint text-ink-muted flex items-center justify-between gap-2 rounded-md border px-4 py-2 text-meta">
        <div className="flex items-center gap-2">
          <Disc className="size-4" strokeWidth={1.5} />
          <span>Audio-CD erkannt — als FLAC rippen</span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Rippen &amp; hochladen
        </Button>
      </div>
      {open && (
        <CdRipDialog device={drive.device} server={server} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
