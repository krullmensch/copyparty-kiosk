import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatSize } from '../lib/format'
import type { ShareResult } from '../../../shared/types'

export interface QrShareItem {
  vpath: string
  name: string
  size: number
  isDirectory: boolean
}

type Phase = 'loading' | 'error' | 'ready'

interface Props {
  server: string
  items: QrShareItem[]
  onClose: () => void
}

/**
 * Confirm-free share dialog: fires the share request on open and shows the
 * resulting QR. Every open == a new share (no cache), per PLAN-QR-SHARE.md.
 */
export function QrShareDialog({ server, items, onClose }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [result, setResult] = useState<ShareResult | null>(null)
  // guards against setState-after-unmount and a stale in-flight request
  // (e.g. rapid retry-clicks) clobbering a newer result. The already-sent
  // IPC call/share can't be un-sent -- this only stops us from acting on it.
  const mountedRef = useRef(true)
  const requestSeqRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const totalBytes = items.reduce((acc, it) => acc + it.size, 0)

  const request = useCallback(async (): Promise<void> => {
    const seq = ++requestSeqRef.current
    setPhase('loading')
    const res = await window.api.cpp.share(server, items)
    if (!mountedRef.current || seq !== requestSeqRef.current) return
    setResult(res)
    setPhase(res.ok ? 'ready' : 'error')
  }, [server, items])

  useEffect(() => {
    void request()
    // only on mount -- items/server are fixed for the lifetime of this dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-background border-border text-foreground w-[24rem] max-w-[90vw] rounded-lg border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="size-5" strokeWidth={1.5} />
            <span className="text-h2">Auf Smartphone laden</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Schließen">
            <X />
          </Button>
        </div>

        {phase === 'loading' && (
          <div className="text-meta text-ink-muted py-10 text-center">Link wird erzeugt…</div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="text-meta text-ink-muted break-words">
              {result?.error ?? 'Unbekannter Fehler'}
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={onClose}>
                Schließen
              </Button>
              <Button className="flex-1" onClick={request}>
                Wiederholen
              </Button>
            </div>
          </div>
        )}

        {phase === 'ready' &&
          (result?.url ? (
            <div className="flex flex-col items-center gap-4">
              {/* fixed white quiet-zone -- must stay scannable in dark mode too */}
              <div className="rounded-md bg-white p-4">
                <QRCodeSVG
                  value={result.url}
                  size={260}
                  level="M"
                  marginSize={2}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
              </div>
              <div className="text-meta text-ink-faint w-full text-center break-all">
                {result.url}
              </div>
              <div className="text-meta text-ink-muted text-center">
                {items.length} Datei{items.length === 1 ? '' : 'en'} ·{' '}
                {result.bytesKnown === false ? 'Größe unbekannt' : formatSize(totalBytes)}
              </div>
              <div className="text-meta text-ink-faint text-center">Link gilt 60 Minuten</div>
              <Button className="w-full" onClick={onClose}>
                Schließen
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="text-meta text-ink-muted break-words">
                Kein Link erhalten
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={onClose}>
                  Schließen
                </Button>
                <Button className="flex-1" onClick={request}>
                  Wiederholen
                </Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
