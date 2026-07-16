import { useEffect, useState } from 'react'
import { categorize } from '../../../shared/filetypes'
import type { PreviewSource } from '../../../shared/types'
import { formatSize } from '../lib/format'
import { streamUrl } from './streamUrl'
import { ProgramPreview } from './viewers/ProgramPreview'
import { MarkdownViewer } from './viewers/MarkdownViewer'

const TEXT_PREVIEW_BYTES = 64 * 1024

/**
 * macOS-artiges Quick-Look-Overlay (Leertaste). Leichtgewichtige Vorschau je Kategorie.
 * Vollwertige Viewer/Editoren leben in FullView.
 */
export function QuickLookOverlay({
  entry,
  source,
  onClose
}: {
  entry: { name: string; size: number }
  source: PreviewSource
  onClose: () => void
}): React.JSX.Element {
  const category = categorize(entry.name)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-background border-border text-foreground flex max-h-[80vh] max-w-[70vw] flex-col overflow-hidden rounded-lg border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border flex items-baseline justify-between gap-4 border-b px-5 py-3">
          <span className="text-h2 truncate">{entry.name}</span>
          <span className="text-meta text-ink-faint shrink-0">{formatSize(entry.size)}</span>
        </div>
        <div className="flex min-h-[8rem] items-center justify-center overflow-auto p-4">
          <QuickLookBody category={category} entry={entry} source={source} />
        </div>
      </div>
    </div>
  )
}

function QuickLookBody({
  category,
  entry,
  source
}: {
  category: ReturnType<typeof categorize>
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  switch (category) {
    case 'image':
      return (
        <img
          src={streamUrl(source)}
          alt={entry.name}
          className="max-h-[60vh] max-w-full object-contain"
        />
      )
    case 'video':
      return (
        <video
          src={streamUrl(source)}
          controls
          autoPlay
          controlsList="nofullscreen nodownload noremoteplayback"
          disablePictureInPicture
          // QuickLook: Tastatur steuert den Player NICHT (Space schließt via
          // usePreviewKeys). Nur Maus-Controls bleiben.
          onKeyDown={(e) => e.preventDefault()}
          className="max-h-[60vh] max-w-full"
        />
      )
    case 'audio':
      return (
        <audio
          src={streamUrl(source)}
          controls
          autoPlay
          onKeyDown={(e) => e.preventDefault()}
          className="w-[28rem] max-w-full"
        />
      )
    case 'markdown':
      return <MarkdownViewer entry={entry} source={source} compact />
    case 'text':
    case 'document':
      return <TextPreview source={source} />
    case 'program':
      return <ProgramPreview source={source} name={entry.name} />
    default:
      return (
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <span className="border-border text-meta rounded border px-2 py-0.5 uppercase tracking-wider">
            {category}
          </span>
          <span className="text-meta text-ink-muted">Keine Schnellvorschau — Enter für Vollansicht</span>
        </div>
      )
  }
}

function TextPreview({ source }: { source: PreviewSource }): React.JSX.Element {
  const [state, setState] = useState<{ text: string; loading: boolean; error: boolean }>({
    text: '',
    loading: true,
    error: false
  })

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await window.api.preview.readText(source, TEXT_PREVIEW_BYTES)
        if (!alive) return
        if (res.error) setState({ text: '', loading: false, error: true })
        else setState({ text: res.text, loading: false, error: false })
      } catch {
        if (alive) setState({ text: '', loading: false, error: true })
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [source])

  if (state.loading) return <div className="text-meta text-ink-muted p-6">Lädt…</div>
  if (state.error) return <div className="text-meta text-ink-muted p-6">Vorschau nicht verfügbar</div>
  return (
    <pre className="text-meta max-h-[60vh] w-[40rem] max-w-full overflow-auto whitespace-pre-wrap break-words font-mono">
      {state.text}
    </pre>
  )
}
