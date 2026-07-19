import { useEffect, useState } from 'react'
import { CompactDisc, Xmark as X, FireFlame } from 'iconoir-react'
import { Button } from '@/components/ui/button'
import type { BurnProgress, BurnSources, DvdVideoBurnProgress } from '../../../shared/types'

/** last path segment, works for POSIX and Windows separators. */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** display names for everything to be burned (local basenames + remote names). */
function sourceNames(s: BurnSources): string[] {
  return [...s.local.map(basename), ...(s.remote?.items.map((it) => it.name) ?? [])]
}

type Phase = 'choose-format' | 'confirm' | 'unavailable' | 'burning' | 'done' | 'error'

/**
 * Confirm + progress dialog for burning local files onto a DVD. Requires
 * xorriso on the kiosk (checked on open). UNTESTED end-to-end until a drive +
 * disc are attached.
 */
export function BurnDialog({
  device,
  sources,
  onClose
}: {
  device: string
  sources: BurnSources
  onClose: () => void
}): React.JSX.Element {
  const names = sourceNames(sources)
  const isSingleVideo = names.length === 1 && /\.(mp4|mkv|avi|mov|webm|flv|wmv|mpg|mpeg)$/i.test(names[0])

  const [phase, setPhase] = useState<Phase>(isSingleVideo ? 'choose-format' : 'confirm')
  const [label] = useState('AGORA')
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  const [targetFormat, setTargetFormat] = useState<'data' | 'video'>('data')
  const [startTime, setStartTime] = useState<number | null>(null)

  useEffect(() => {
    void window.api.burn.available().then((ok) => {
      if (!ok) {
        setPhase('unavailable')
      }
    })
  }, [])

  useEffect(() => {
    const off1 = window.api.burn.onProgress((p: BurnProgress) => {
      if (p.kind === 'blank') setMessage('Disc wird geleert…')
      else if (p.kind === 'prepare') setMessage('Vorbereiten…')
      else if (p.kind === 'write') {
        setMessage('Schreiben…')
        setPercent(p.percent)
      } else if (p.kind === 'done') {
        setPhase('done')
      } else if (p.kind === 'error') {
        setPhase('error')
        setMessage(p.message)
      }
    })
    
    const off2 = window.api.dvdburn.onProgress((p: DvdVideoBurnProgress) => {
      if (p.kind === 'prepare') setMessage('Vorbereiten (Download)…')
      else if (p.kind === 'transcode') {
        setMessage('Video wird für DVD konvertiert…')
        setPercent(p.percent)
      }
      else if (p.kind === 'author') {
        setMessage('DVD-Struktur wird erstellt…')
        setPercent(100) // Dummy for authoring phase
      }
      else if (p.kind === 'write') {
        setMessage('Schreiben…')
        setPercent(p.percent)
      } else if (p.kind === 'done') {
        setPhase('done')
      } else if (p.kind === 'error') {
        setPhase('error')
        setMessage(p.message)
      }
    })
    return () => {
      off1()
      off2()
    }
  }, [])

  const startBurn = async (): Promise<void> => {
    setPhase('burning')
    setMessage('Vorbereiten…')
    setStartTime(Date.now())
    const res = targetFormat === 'video' 
      ? await window.api.dvdburn.start(device, sources, label)
      : await window.api.burn.start(device, sources, label)
      
    if (!res.ok) {
      setPhase('error')
      setMessage(res.message ?? 'Brennen fehlgeschlagen')
    }
  }

  const getEta = (): string | null => {
    if (!startTime || percent <= 0 || percent >= 100) return null
    const elapsed = (Date.now() - startTime) / 1000
    const total = elapsed / (percent / 100)
    const remaining = Math.max(0, total - elapsed)
    
    if (remaining < 60) return 'Weniger als eine Minute verbleibend'
    const mins = Math.ceil(remaining / 60)
    return `Ca. ${mins} Minute${mins > 1 ? 'n' : ''} verbleibend`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={phase === 'burning' ? undefined : onClose}>
      <div
        className="bg-background border-border text-foreground w-[30rem] max-w-[90vw] rounded-card border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {phase !== 'confirm' && phase !== 'choose-format' && phase !== 'burning' && (
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CompactDisc className="size-5" strokeWidth={1.5} />
              <span className="text-h2">Auf DVD brennen</span>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen">
              <X />
            </Button>
          </div>
        )}

        {phase === 'unavailable' && (
          <div className="text-meta text-ink-muted">
            Brenn-Programm <code>xorriso</code> ist auf diesem Kiosk nicht installiert.
          </div>
        )}

        {phase === 'choose-format' && (
          <div className="flex flex-col gap-6 text-center pt-2">
            <div className="text-xl font-bold uppercase leading-snug">
              Wähle das Format
            </div>
            <div className="text-meta text-ink-muted">
              Das ausgewählte Video kann als echte Video-DVD (für DVD-Player) oder als normale Daten-DVD (für PCs) gebrannt werden.
            </div>
            <div className="flex flex-col gap-3">
              <Button className="w-full font-bold uppercase" variant="outline" onClick={() => { setTargetFormat('video'); setPhase('confirm'); }}>
                <FireFlame className="size-5 mr-2" />
                Als Video-DVD brennen
              </Button>
              <Button className="w-full font-bold uppercase" variant="outline" onClick={() => { setTargetFormat('data'); setPhase('confirm'); }}>
                <CompactDisc className="size-5 mr-2" />
                Als Daten-DVD brennen
              </Button>
            </div>
          </div>
        )}

        {phase === 'confirm' && (
          <div className="flex flex-col items-center justify-center py-4 text-center gap-8">
            <div className="text-xl font-bold uppercase leading-snug">
              <div>ACHTUNG!</div>
              <div>DIE AUSGEWÄHLTEN DATEN WERDEN</div>
              <div>NUN AUF DIE DISC GEBRANNT!</div>
            </div>
            
            <div className="flex gap-4 w-full justify-center">
              <Button className="font-bold uppercase flex-1" variant="outline" onClick={onClose}>
                <X className="size-5 mr-2" />
                ABBRECHEN
              </Button>
              <Button className="font-bold uppercase flex-1 bg-ink text-white hover:opacity-90" onClick={startBurn}>
                <FireFlame className="size-5 mr-2" />
                BRENNEN
              </Button>
            </div>
          </div>
        )}

        {phase === 'burning' && (
          <div className="flex flex-col gap-4">
            <div className="text-h2 text-center mb-2">Brennen läuft…</div>
            <div className="text-meta text-ink-muted text-center">{message}</div>
            <div className="bg-border h-3 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-meta text-ink-faint">
              <span>{getEta() ?? 'Berechne verbleibende Zeit…'}</span>
              <span className="font-bold">{percent}%</span>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted">Fertig — Disc wird ausgeworfen.</div>
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
