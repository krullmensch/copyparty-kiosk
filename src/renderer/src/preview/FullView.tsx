import { useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import { categorize, officeViewable } from '../../../shared/filetypes'
import type { PreviewSource } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { MetadataPanel } from './MetadataPanel'
import { ProgramPreview } from './viewers/ProgramPreview'
import { ImageViewer } from './viewers/ImageViewer'
import { TextViewer } from './viewers/TextViewer'
import { MarkdownViewer } from './viewers/MarkdownViewer'
import { VideoPlayer } from './viewers/VideoPlayer'
import { AudioPlayer } from './viewers/AudioPlayer'
import { DocumentViewer } from './viewers/DocumentViewer'
import { OfficeViewer } from './viewers/OfficeViewer'
import { ModelViewer } from './viewers/ModelViewer'

/**
 * Vollansicht (Enter/Doppelklick). Deckendes Modal mit Kategorie-Dispatch auf
 * Viewer/Editoren + optionaler Metadaten-Seitenleiste.
 *
 * Künftige Viewer (TSK-10..15) erhalten einheitlich Props { entry, source }.
 * Ersetze je Kategorie den Platzhalter durch einen Import + eine JSX-Zeile.
 */
export function FullView({
  entry,
  source,
  onClose
}: {
  entry: { name: string; size: number }
  source: PreviewSource
  onClose: () => void
}): React.JSX.Element {
  const [showMeta, setShowMeta] = useState(false)
  const category = categorize(entry.name)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col">
      <div className="border-border flex items-center justify-between gap-4 border-b px-4 py-2">
        <span className="text-h2 truncate">{entry.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={showMeta ? 'secondary' : 'ghost'}
            size="icon"
            className="rounded-full"
            onClick={() => setShowMeta((v) => !v)}
            aria-label="Metadaten"
          >
            <Info />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={onClose} aria-label="Schließen">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">{renderViewer(category, entry, source)}</div>
        {showMeta && (
          <div className="border-border w-80 shrink-0 border-l">
            <MetadataPanel source={source} />
          </div>
        )}
      </div>
    </div>
  )
}

// Viewer-Dispatch. TSK-10..15 ersetzen die Platzhalter durch echte Komponenten,
// alle mit Props { entry, source }.
function renderViewer(
  category: ReturnType<typeof categorize>,
  entry: { name: string; size: number },
  source: PreviewSource
): React.JSX.Element {
  switch (category) {
    case 'text':
      return <TextViewer entry={entry} source={source} />
    case 'markdown':
      return <MarkdownViewer entry={entry} source={source} />
    case 'document':
      // Office-Formate von einer REMOTE-Quelle rendert OnlyOffice DS schöner
      // (iframe). OfficeViewer fällt bei DS-down selbst auf DocumentViewer
      // zurück. LOCAL-Quellen (USB/CD) bleiben immer beim DocumentViewer — der
      // DS kann lokale Dateien nicht laden.
      if (source.kind === 'remote' && officeViewable(entry.name)) {
        return <OfficeViewer entry={entry} source={source} />
      }
      return <DocumentViewer entry={entry} source={source} />
    case 'audio':
      return <AudioPlayer entry={entry} source={source} />
    case 'video':
      return <VideoPlayer entry={entry} source={source} />
    case 'image':
      return <ImageViewer entry={entry} source={source} />
    case 'model3d':
      return <ModelViewer entry={entry} source={source} />
    case 'program':
      // Provider öffnet FullView für Programme normalerweise nicht (nur QuickLook).
      // Fallback ohne Crash, falls doch aufgerufen.
      return (
        <div className="flex h-full items-center justify-center">
          <ProgramPreview source={source} name={entry.name} />
        </div>
      )
    default:
      return <Placeholder label="Keine Vollansicht für diesen Dateityp" />
  }
}

function Placeholder({ label }: { label: string }): React.JSX.Element {
  return <div className="text-ink-muted flex h-full items-center justify-center">{label}</div>
}
