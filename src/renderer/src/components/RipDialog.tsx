import { useEffect, useState } from 'react'
import { Disc, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DvdRipProgress } from '../../../shared/types'

type Phase = 'confirm' | 'unavailable' | 'ripping' | 'done' | 'error'
type Stage = 'scan' | 'encode' | 'upload'

/**
 * Confirm + progress dialog for ripping a video DVD's main feature and
 * uploading it to the Agora root. Requires HandBrakeCLI + libdvdcss on
 * the kiosk (checked on open, see kiosk-infra memory).
 */
export function RipDialog({
  mountPath,
  label,
  server,
  onClose
}: {
  mountPath: string
  label: string
  server: string
  onClose: () => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('confirm')
  const [stage, setStage] = useState<Stage>('scan')
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void window.api.dvdrip.available().then((ok) => {
      if (!ok) setPhase('unavailable')
    })
  }, [])

  useEffect(() => {
    const off = window.api.dvdrip.onProgress((p: DvdRipProgress) => {
      if (p.kind === 'scan') {
        setStage('scan')
      } else if (p.kind === 'encode') {
        setStage('encode')
        setPercent(p.percent)
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
    const res = await window.api.dvdrip.start(mountPath, label, server)
    if (!res.ok) {
      if (res.message === 'Abgebrochen') {
        onClose()
      } else {
        setPhase('error')
        setMessage(res.message ?? 'Hinzufügen fehlgeschlagen')
      }
    }
  }

  const cancel = async (): Promise<void> => {
    await window.api.dvdrip.cancel()
  }

  const stageLabel: Record<Stage, string> = {
    scan: 'Disc wird gescannt…',
    encode: 'Hauptfilm wird importiert & kodiert…',
    upload: 'Wird auf Agora hochgeladen…'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={phase === 'ripping' ? undefined : onClose}>
      <div
        className="bg-background border-ink text-foreground w-[30rem] max-w-[90vw] rounded-container border-2 p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Disc className="size-5" strokeWidth={2} />
            <span className="text-h2">Video-DVD importieren</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen" disabled={phase === 'ripping'}>
            <X />
          </Button>
        </div>

        {phase === 'unavailable' && (
          <div className="text-meta text-ink-muted">
            <code>HandBrakeCLI</code> ist auf diesem Kiosk nicht installiert.
          </div>
        )}

        {phase === 'confirm' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted">
              Hauptfilm von <code>{label}</code> wird erkannt, entschlüsselt, nach H.264
              transkodiert (MP4 mit allen Tonspuren) und auf Agora hochgeladen. Das kann
              je nach Länge mehrere Minuten dauern.
            </div>
            <Button className="w-full" onClick={start}>
              Zur Agora hinzufügen
            </Button>
          </div>
        )}

        {phase === 'ripping' && (
          <div className="flex flex-col gap-3">
            <div className="text-meta text-ink-muted">{stageLabel[stage]}</div>
            {stage !== 'scan' && (
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
            <Button variant="outline" className="w-full mt-2" onClick={cancel}>
              Abbrechen
            </Button>
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
