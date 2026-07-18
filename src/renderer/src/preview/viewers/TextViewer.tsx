import { useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import type { PreviewSource } from '../../../../shared/types'

const MAX = 2 * 1024 * 1024 // 2 MB

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

/** Sprach-Extension + Label aus der Dateiendung. Unbekannt → nur Basis-Viewer. */
function languageFor(name: string): { ext: Extension | null; label: string } {
  switch (extensionOf(name)) {
    case 'html':
    case 'htm':
      return { ext: html(), label: 'HTML' }
    case 'py':
      return { ext: python(), label: 'Python' }
    case 'css':
      return { ext: css(), label: 'CSS' }
    case 'js':
    case 'jsx':
      return { ext: javascript({ jsx: true }), label: 'JavaScript' }
    case 'ts':
      return { ext: javascript({ typescript: true }), label: 'TypeScript' }
    case 'tsx':
      return { ext: javascript({ jsx: true, typescript: true }), label: 'TypeScript' }
    case 'json':
      return { ext: json(), label: 'JSON' }
    case 'md':
    case 'markdown':
      return { ext: markdown(), label: 'Markdown' }
    default:
      return { ext: null, label: 'Text' }
  }
}

/**
 * Read-only Text-/Code-Ansicht mit CodeMirror-Syntax-Highlighting. Lädt den
 * Inhalt über preview.readText und zeigt ihn schreibgeschützt an — die App ist
 * ein reiner Viewer, kein Editor.
 */
export function TextViewer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const lang = languageFor(entry.name)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setTruncated(false)

    window.api.preview.readText(source, MAX).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.error) {
        setError(res.error)
        return
      }

      setTruncated(res.truncated)

      const host = hostRef.current
      if (!host) return

      const dark = document.documentElement.classList.contains('dark')

      const extensions: Extension[] = [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' }
        })
      ]
      if (lang.ext) extensions.push(lang.ext)
      // Dark: oneDark bringt eigene Highlight-Farben mit. Light: braucht einen
      // expliziten Highlight-Style, sonst rendert CodeMirror die Syntax farblos.
      if (dark) extensions.push(oneDark)
      else extensions.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }))

      const view = new EditorView({
        state: EditorState.create({ doc: res.text, extensions }),
        parent: host
      })
      viewRef.current = view
    })

    return () => {
      alive = false
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, entry.name])

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="border-border flex items-center gap-3 border-b px-4 py-2">
        <span className="text-meta text-ink-muted">{lang.label}</span>
        {truncated && (
          <span className="text-meta text-ink-faint">Große Datei — gekürzt angezeigt</span>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="text-ink-muted absolute inset-0 flex items-center justify-center">
            Lädt…
          </div>
        )}
        {error && (
          <div className="text-ink-muted absolute inset-0 flex items-center justify-center">
            {error}
          </div>
        )}
        <div ref={hostRef} className="h-full overflow-auto" />
      </div>
    </div>
  )
}
