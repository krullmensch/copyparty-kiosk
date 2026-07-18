import { useEffect, useState } from 'react'
import type { PreviewSource } from '../../../../shared/types'
import { DocumentViewer } from './DocumentViewer'

type ViewerProps = {
  entry: { name: string; size: number }
  source: PreviewSource
}

// Kurzer Timeout für den DS-Healthcheck: der Server ist im selben LAN, wenn er
// nicht binnen 3 s antwortet, gilt er als down und wir fallen auf den
// clientseitigen Viewer zurück.
const HEALTH_TIMEOUT_MS = 3000

type Decision = 'checking' | 'iframe' | 'fallback'

function Spinner(): React.JSX.Element {
  return (
    <div className="text-ink-muted absolute inset-0 flex items-center justify-center">Lädt…</div>
  )
}

/**
 * Office-Viewer für REMOTE-Dokumente (docx/xlsx/pptx/odt/ods/odp/csv …).
 *
 * Rendert das Dokument read-only über den OnlyOffice Document Server: die
 * agora-server-Seite `/oo-view` bettet OO ein und lässt den DS das Dokument
 * selbst per copyparty-URL laden. Wir zeigen sie als <iframe>.
 *
 * Zwei Fallback-Grenzen, beide → bestehender {@link DocumentViewer}
 * (mammoth/SheetJS/PDF/…):
 *  - LOCAL-Quelle (USB/CD): hat keine copyparty-URL, der DS kann die Datei nicht
 *    laden. Wird bereits im FullView-Dispatch abgefangen; hier defensiv nochmal.
 *  - DS down: Healthcheck (:8081) schlägt fehl oder läuft in den Timeout.
 *
 * Host wird zur Laufzeit aus der App-Config gelesen (`~/.agora/host`, dieselbe
 * Quelle wie copyparty :3923 und Dashboard :8080) — nichts hardcoded.
 */
export function OfficeViewer({ entry, source }: ViewerProps): React.JSX.Element {
  const [decision, setDecision] = useState<Decision>('checking')
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setDecision('checking')
    setIframeUrl(null)
    setIframeLoaded(false)

    // LOCAL kann OO nicht laden → Fallback (defensiv; FullView gated bereits).
    if (source.kind !== 'remote') {
      setDecision('fallback')
      return
    }
    const vpath = source.vpath

    const run = async (): Promise<void> => {
      try {
        const host = await window.api.config.getHost()
        if (!alive) return
        const res = await fetch(`http://${host}:8081/healthcheck`, {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
        })
        if (!alive) return
        if (res.ok) {
          setIframeUrl(`http://${host}:8080/oo-view?doc=${encodeURIComponent(vpath)}`)
          setDecision('iframe')
        } else {
          setDecision('fallback')
        }
      } catch {
        if (alive) setDecision('fallback')
      }
    }
    void run()

    return () => {
      alive = false
    }
  }, [source])

  if (decision === 'fallback') return <DocumentViewer entry={entry} source={source} />

  if (decision === 'checking') {
    return (
      <div className="bg-background relative h-full w-full">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="bg-background relative h-full w-full">
      {!iframeLoaded && <Spinner />}
      {iframeUrl && (
        <iframe
          src={iframeUrl}
          title={entry.name}
          onLoad={() => setIframeLoaded(true)}
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      )}
    </div>
  )
}
