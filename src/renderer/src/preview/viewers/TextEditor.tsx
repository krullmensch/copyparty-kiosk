import { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { gooeyToast as toast } from 'goey-toast'
import type { PreviewSource } from '../../../../shared/types'
import { Button } from '@/components/ui/button'

const MAX = 2 * 1024 * 1024 // 2 MB

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

/** Sprach-Extension + Label aus der Dateiendung. Unbekannt → nur Basis-Editor. */
function languageFor(name: string): { ext: Extension | null; label: string } {
  switch (extensionOf(name)) {
    case 'md':
    case 'markdown':
      return { ext: markdown(), label: 'Markdown' }
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
    default:
      return { ext: null, label: 'Text' }
  }
}

export function TextEditor({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const baselineRef = useRef<string>('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // readOnly-Grund: remote-Quelle oder große (truncated) Datei.
  const [readOnlyReason, setReadOnlyReason] = useState<'remote' | 'truncated' | null>(null)

  const lang = languageFor(entry.name)

  // Save-Handler in ein Ref, damit der keymap-Eintrag stabil bleibt.
  const saveRef = useRef<() => void>(() => {})

  const doSave = async (): Promise<void> => {
    const view = viewRef.current
    // Nur lokale Quellen sind schreibbar (fs.write ist local-only).
    if (!view || source.kind === 'remote') return
    const content = view.state.doc.toString()
    const res = await window.api.fs.write(source.path, content)
    if (res.ok) {
      baselineRef.current = content
      setDirty(false)
      toast.success('Gespeichert')
    } else {
      toast.error(res.message ?? 'Speichern fehlgeschlagen')
    }
  }
  saveRef.current = () => {
    void doSave()
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setDirty(false)

    window.api.preview.readText(source, MAX).then((res) => {
      if (!alive) return
      setLoading(false)
      if (res.error) {
        setError(res.error)
        return
      }

      const isRemote = source.kind === 'remote'
      const reason: 'remote' | 'truncated' | null = isRemote
        ? 'remote'
        : res.truncated
          ? 'truncated'
          : null
      setReadOnlyReason(reason)
      const readOnly = reason !== null

      const host = hostRef.current
      if (!host) return

      baselineRef.current = res.text

      const dark = document.documentElement.classList.contains('dark')

      const extensions: Extension[] = [
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              saveRef.current()
              return true
            }
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab
        ]),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' }
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            setDirty(u.state.doc.toString() !== baselineRef.current)
          }
        })
      ]
      if (lang.ext) extensions.push(lang.ext)
      // Dark: oneDark bringt eigene Highlight-Farben mit. Light: braucht einen
      // expliziten Highlight-Style, sonst rendert CodeMirror die Syntax farblos.
      if (dark) extensions.push(oneDark)
      else extensions.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }))
      if (readOnly) {
        extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
      }

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

  const editable = readOnlyReason === null

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="border-border flex items-center gap-3 border-b px-4 py-2">
        <span className="text-meta text-ink-muted">{lang.label}</span>
        {readOnlyReason === 'remote' && (
          <span className="text-meta text-ink-faint">Remote — schreibgeschützt</span>
        )}
        {readOnlyReason === 'truncated' && (
          <span className="text-meta text-ink-faint">Große Datei — schreibgeschützt</span>
        )}
        {editable && dirty && (
          <span className="text-ink-muted flex items-center gap-1.5 text-meta">
            <span className="bg-foreground inline-block size-1.5 rounded-full" />
            Ungespeichert
          </span>
        )}
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            disabled={!dirty}
            onClick={() => saveRef.current()}
          >
            <Save /> Speichern
          </Button>
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
