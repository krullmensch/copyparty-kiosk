import { useEffect, useState } from 'react'
import { Disc, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BurnProgress, BurnSources } from '../../../shared/types'

/** last path segment, works for POSIX and Windows separators. */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** display names for everything to be burned (local basenames + remote names). */
function sourceNames(s: BurnSources): string[] {
  return [...s.local.map(basename), ...(s.remote?.items.map((it) => it.name) ?? [])]
}

type Phase = 'confirm' | 'unavailable' | 'burning' | 'done' | 'error'

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
  const [phase, setPhase] = useState<Phase>('confirm')
  const [label, setLabel] = useState('AGORA')
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void window.api.burn.available().then((ok) => {
      if (!ok) {
        setPhase('unavailable')
      }
    })
  }, [])

  useEffect(() => {
    const off = window.api.burn.onProgress((p: BurnProgress) => {
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
    return off
  }, [])

  const start = async (): Promise<void> => {
    setPhase('burning')
    setMessage('Vorbereiten…')
    const res = await window.api.burn.start(device, sources, label)
    if (!res.ok) {
      setPhase('error')
      setMessage(res.message ?? 'Brennen fehlgeschlagen')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border-border text-foreground w-[30rem] max-w-[90vw] rounded-card border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Disc className="size-5" strokeWidth={1.5} />
            <span className="text-h2">Auf DVD brennen</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen">
            <X />
          </Button>
        </div>

        {phase === 'unavailable' && (
          <div className="text-meta text-ink-muted">
            Brenn-Programm <code>xorriso</code> ist auf diesem Kiosk nicht installiert.
          </div>
        )}

        {phase === 'confirm' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted">
              {names.length} Objekt(e) auf die Disc in <code>{device}</code> brennen:
            </div>
            <ul className="text-meta text-ink-faint max-h-40 overflow-auto">
              {names.map((n) => (
                <li key={n} className="truncate">
                  {n}
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1">
              <Label className="text-meta text-ink-faint">Disc-Name</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} />
            </div>
            <div className="text-meta text-ink-faint">
              Achtung: Wiederbeschreibbare Discs (DVD+RW) werden vor dem Brennen geleert.
            </div>
            <Button className="w-full" onClick={start}>
              Brennen
            </Button>
          </div>
        )}

        {phase === 'burning' && (
          <div className="flex flex-col gap-3">
            <div className="text-meta text-ink-muted">{message}</div>
            <div className="bg-border h-2 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="text-meta text-ink-faint text-right">{percent}%</div>
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
