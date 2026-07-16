import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PreviewSource } from '../../../../shared/types'

const MAX = 2 * 1024 * 1024 // 2 MB

/**
 * Read-only Markdown-Ansicht. Rendert GFM (Tabellen, Strikethrough, Autolinks)
 * über react-markdown/remark-gfm, kein Editing. Genutzt von QuickLook (immer)
 * und FullView-Vorschau-Modus (MarkdownPane) — Bearbeiten läuft dort über
 * TextEditor auf dem Rohtext.
 */
export function MarkdownViewer({
  entry,
  source,
  compact = false
}: {
  entry: { name: string; size: number }
  source: PreviewSource
  /** QuickLook: kleinere Standardbreite statt der 46rem-Lesebreite in FullView. */
  compact?: boolean
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setText(null)
    setTruncated(false)
    setError(null)

    window.api.preview.readText(source, MAX).then((res) => {
      if (!alive) return
      if (res.error) {
        setError(res.error)
        return
      }
      setText(res.text)
      setTruncated(res.truncated)
    })

    return () => {
      alive = false
    }
  }, [source])

  if (error) {
    return (
      <div className="text-ink-muted flex h-full items-center justify-center p-6 text-center">
        {error}
      </div>
    )
  }
  if (text === null) {
    return (
      <div className="text-ink-muted flex h-full items-center justify-center">Lädt…</div>
    )
  }

  return (
    <div className={compact ? 'w-[40rem] max-w-full' : 'bg-background h-full overflow-auto'}>
      <style>{`
        .cpp-md { max-width: 46rem; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.6; }
        .cpp-md.cpp-md--compact { padding: 0; }
        .cpp-md p { margin: 0 0 0.75rem; }
        .cpp-md h1, .cpp-md h2, .cpp-md h3, .cpp-md h4, .cpp-md h5, .cpp-md h6 {
          margin: 1.25rem 0 0.5rem;
          font-weight: 600;
        }
        .cpp-md h1 { font-size: 1.8rem; }
        .cpp-md h2 { font-size: 1.5rem; }
        .cpp-md h3 { font-size: 1.3rem; }
        .cpp-md h4 { font-size: 1.15rem; }
        .cpp-md h5 { font-size: 1.05rem; }
        .cpp-md h6 { font-size: 1rem; }
        .cpp-md ul, .cpp-md ol { margin: 0 0 0.75rem 1.5rem; }
        .cpp-md li { margin: 0.2rem 0; }
        .cpp-md a { text-decoration: underline; }
        .cpp-md strong { font-weight: 700; }
        .cpp-md em { font-style: italic; }
        .cpp-md blockquote {
          margin: 0 0 0.75rem;
          padding: 0.25rem 0 0.25rem 1rem;
          border-left: 3px solid var(--border);
          color: var(--ink-muted, inherit);
        }
        .cpp-md code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.9em;
          background: var(--muted, rgba(128, 128, 128, 0.15));
          padding: 0.15em 0.35em;
          border-radius: 0.25rem;
        }
        .cpp-md pre {
          margin: 0 0 0.75rem;
          padding: 0.75rem 1rem;
          overflow-x: auto;
          background: var(--muted, rgba(128, 128, 128, 0.15));
          border-radius: 0.375rem;
        }
        .cpp-md pre code { background: none; padding: 0; }
        .cpp-md table { border-collapse: collapse; margin: 0.75rem 0; }
        .cpp-md td, .cpp-md th { border: 1px solid var(--border); padding: 0.25rem 0.5rem; }
        .cpp-md th { font-weight: 600; }
        .cpp-md img { max-width: 100%; height: auto; }
        .cpp-md hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
      `}</style>
      <div className={`cpp-md text-foreground ${compact ? 'cpp-md--compact' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
      {truncated && (
        <div className="border-border text-meta text-ink-faint border-t px-4 py-2">
          {entry.name} — … gekürzt (Datei größer als 2 MB)
        </div>
      )}
    </div>
  )
}
