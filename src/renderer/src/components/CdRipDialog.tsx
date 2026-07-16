import { useEffect, useState } from 'react'
import { Disc, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CdRipProgress } from '../../../shared/types'

type Phase = 'confirm' | 'unavailable' | 'ripping' | 'done' | 'error'
type Stage = 'scan' | 'rip' | 'encode' | 'upload'

/**
 * Confirm + progress dialog for ripping an audio CD's tracks to FLAC and
 * uploading them to the Agora root. Requires cdparanoia on the kiosk
 * (checked on open, see kiosk-infra memory).
 */
export function CdRipDialog({
  device,
  server,
  onClose
}: {
  device: string
  server: string
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('confirm')
  const [stage, setStage] = useState<Stage>('scan')
  const [track, setTrack] = useState(0)
  const [total, setTotal] = useState(0)
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void window.api.cdrip.available().then((ok) => {
      if (!ok) setPhase('unavailable')
    })
  }, [])

  useEffect(() => {
    const off = window.api.cdrip.onProgress((p: CdRipProgress) => {
      if (p.kind === 'scan') {
        setStage('scan')
      } else if (p.kind === 'rip') {
        setStage('rip')
        setTrack(p.track)
        setTotal(p.total)
        setPercent(p.percent)
      } else if (p.kind === 'encode') {
        setStage('encode')
        setTrack(p.track)
        setTotal(p.total)
      } else if (p.kind === 'upload') {
        setStage('upload')
        setPercent(p.percent)
      } else if (p.kind === 'done') {
        setPhase('done')
      } else if (p.kind === 'error') {
        setPhase('error')
        setMessage(p.message)
      }
    })
    return off
  }, [])

  const start = async (): Promise<void> => {
    setPhase('ripping')
    setStage('scan')
    setPercent(0)
    const res = await window.api.cdrip.start(device, server)
    if (!res.ok) {
      setPhase('error')
      setMessage(res.message ?? 'Rippen fehlgeschlagen')
    }
  }

  const stageLabel: Record<Stage, string> = {
    scan: 'Disc wird gescannt…',
    rip: `Track ${track}/${total} wird gelesen…`,
    encode: `Track ${track}/${total} wird zu FLAC kodiert…`,
    upload: 'Wird auf Agora hochgeladen…'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border-border text-foreground w-[30rem] max-w-[90vw] rounded-lg border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Disc className="size-5" strokeWidth={1.5} />
            <span className="text-h2">Audio-CD rippen</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen">
            <X />
          </Button>
        </div>

        {phase === 'unavailable' && (
          <div className="text-meta text-ink-muted">
            <code>cdparanoia</code> ist auf diesem Kiosk nicht installiert.
          </div>
        )}

        {phase === 'confirm' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted">
              Alle Tracks werden mit Fehlerkorrektur gelesen, verlustfrei nach FLAC
              kodiert und auf Agora hochgeladen. Das kann je nach CD einige Minuten
              dauern.
            </div>
            <Button className="w-full" onClick={start}>
              Rippen &amp; hochladen
            </Button>
          </div>
        )}

        {phase === 'ripping' && (
          <div className="flex flex-col gap-3">
            <div className="text-meta text-ink-muted">{stageLabel[stage]}</div>
            {(stage === 'rip' || stage === 'upload') && (
              <>
                <div className="bg-border h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="text-meta text-ink-faint text-right">{percent}%</div>
              </>
            )}
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted">
              Fertig — liegt jetzt auf Agora.
            </div>
            <Button className="w-full" onClick={onClose}>
              Schließen
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted break-words">{message}</div>
            <Button className="w-full" variant="outline" onClick={onClose}>
              Schließen
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
