import { useState } from 'react'
import type { PreviewSource } from '../../../../shared/types'
import { Button } from '@/components/ui/button'
import { MarkdownViewer } from './MarkdownViewer'
import { TextEditor } from './TextEditor'

type Mode = 'preview' | 'edit'

/**
 * FullView-Wrapper für Markdown: Toggle zwischen gerenderter Vorschau
 * (MarkdownViewer, read-only) und Rohtext-Bearbeitung (TextEditor,
 * CodeMirror mit Markdown-Highlighting + Save). QuickLook bleibt unberührt
 * und nutzt weiterhin MarkdownViewer direkt.
 */
export function MarkdownPane({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('preview')

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="border-border flex items-center gap-2 border-b px-4 py-2">
        <span className="text-meta text-ink-muted mr-2">Markdown</span>
        <Button
          variant={mode === 'preview' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setMode('preview')}
        >
          Vorschau
        </Button>
        <Button
          variant={mode === 'edit' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setMode('edit')}
        >
          Bearbeiten
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {mode === 'preview' ? (
          <MarkdownViewer entry={entry} source={source} />
        ) : (
          <TextEditor entry={entry} source={source} />
        )}
      </div>
    </div>
  )
}
