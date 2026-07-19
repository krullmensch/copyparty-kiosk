import { useState } from 'react'
import { Disc } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DriveInfo } from '../../../shared/types'
import { RipDialog } from './RipDialog'

/**
 * Shown instead of/alongside the plain file browser when the mounted disc is
 * a video DVD (has VIDEO_TS). Offers ripping the main feature to Agora.
 */
export function DvdRipBanner({
  drive,
  server
}: {
  drive: DriveInfo
  server: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const mount = drive.mountpoints[0]
  const label = mount?.label ?? 'DVD'

  return (
    <>
      <div className="border-border bg-bg-page-tint text-ink-muted flex items-center justify-between gap-2 rounded-input border px-4 py-2 text-meta">
        <div className="flex items-center gap-2">
          <Disc className="size-4" strokeWidth={1.5} />
          <span>
            Video-DVD erkannt{label ? ` · ${label}` : ''} — Dateien sind CSS-verschlüsselt
          </span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Rippen &amp; hochladen
        </Button>
      </div>
      {open && mount && (
        <RipDialog mountPath={mount.path} label={label} server={server} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
