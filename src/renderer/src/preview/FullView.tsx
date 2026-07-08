import { useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import { categorize } from '../../../shared/filetypes'
import type { PreviewSource } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { MetadataPanel } from './MetadataPanel'
import { ProgramPreview } from './viewers/ProgramPreview'
import { ImageViewer } from './viewers/ImageViewer'
import { TextEditor } from './viewers/TextEditor'

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
            onClick={() => setShowMeta((v) => !v)}
            aria-label="Metadaten"
          >
            <Info />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Schließen">
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
      return <TextEditor entry={entry} source={source} />
    case 'document':
      return <Placeholder label="DocumentViewer folgt (TSK-11)" />
    case 'audio':
      return <Placeholder label="AudioPlayer folgt (TSK-12)" />
    case 'video':
      return <Placeholder label="VideoPlayer folgt (TSK-13)" />
    case 'image':
      return <ImageViewer entry={entry} source={source} />
    case 'model3d':
      return <Placeholder label="3D-Viewer folgt (TSK-15)" />
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
