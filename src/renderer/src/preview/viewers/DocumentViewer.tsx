import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
// Worker MUSS lokal gebundelt werden (Offline-Sneakernet, kein CDN).
// Vite emittiert die .mjs als lokales Asset und liefert eine same-origin-URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import ePub from 'epubjs'
import type { PreviewSource } from '../../../../shared/types'
import { formatSize } from '../../lib/format'
import { Button } from '@/components/ui/button'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MAX_ROWS = 1000
const CSV_MAX = 1024 * 1024 // 1 MB

type ViewerProps = {
  entry: { name: string; size: number }
  source: PreviewSource
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0 || idx === name.length - 1) return ''
  return name.slice(idx + 1).toLowerCase()
}

// ---- gemeinsame Bausteine -------------------------------------------------

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-ink-muted flex h-full items-center justify-center p-6 text-center">
      {children}
    </div>
  )
}

function ErrorPanel({ name, message }: { name: string; message: string }): React.JSX.Element {
  return (
    <Centered>
      <div>
        <div className="text-foreground">{name}</div>
        <div className="text-meta text-ink-faint mt-1">{message}</div>
      </div>
    </Centered>
  )
}

// ---- PDF ------------------------------------------------------------------

function PdfDoc({ entry, source }: ViewerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const taskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // Dokument laden.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setPage(1)
    setTotal(0)

    const load = async (): Promise<void> => {
      const bytes = await window.api.preview.readBytes(source)
      if (!alive) return
      if (!bytes) {
        setError('Datei konnte nicht gelesen werden (zu groß oder Fehler).')
        setLoading(false)
        return
      }
      try {
        const task = pdfjsLib.getDocument({ data: bytes })
        taskRef.current = task
        const doc = await task.promise
        if (!alive) {
          void task.destroy()
          return
        }
        pdfRef.current = doc
        setTotal(doc.numPages)
        setLoading(false)
      } catch {
        if (alive) {
          setError('PDF konnte nicht geöffnet werden.')
          setLoading(false)
        }
      }
    }
    void load()

    return () => {
      alive = false
      void taskRef.current?.destroy()
      taskRef.current = null
      pdfRef.current = null
    }
  }, [source])

  // Aktuelle Seite rendern.
  useEffect(() => {
    const doc = pdfRef.current
    if (!doc || total === 0) return
    let cancelled = false
    let renderTask: pdfjsLib.RenderTask | null = null

    const render = async (): Promise<void> => {
      try {
        const p = await doc.getPage(page)
        if (cancelled) return
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return
        const base = p.getViewport({ scale: 1 })
        const avail = container.clientWidth - 32
        const scale = avail > 0 ? Math.min(avail / base.width, 3) : 1
        const viewport = p.getViewport({ scale })
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        // PDF-Seiten haben keinen eigenen Hintergrund — weiß füllen, sonst
        // zeichnet pdf.js nur die Vektoren auf transparentes Canvas.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, viewport.width, viewport.height)
        renderTask = p.render({ canvasContext: ctx, viewport })
        await renderTask.promise
      } catch (err) {
        // Abbruch beim Seitenwechsel ist kein Fehler; echte Fehler zeigen.
        const name = err instanceof Error ? err.name : ''
        if (!cancelled && name !== 'RenderingCancelledException') {
          setError('Seite konnte nicht gerendert werden.')
        }
      }
    }
    void render()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [page, total])

  if (error) return <ErrorPanel name={entry.name} message={error} />

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="border-border flex items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => setPage((n) => Math.max(1, n - 1))}
        >
          <ChevronLeft />
        </Button>
        <span className="text-meta text-ink-muted w-20 text-center">
          {total > 0 ? `${page} / ${total}` : '—'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= total}
          onClick={() => setPage((n) => Math.min(total, n + 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto p-4">
        {loading && (
          <div className="text-ink-muted absolute inset-0 flex items-center justify-center">
            Lädt…
          </div>
        )}
        <canvas ref={canvasRef} className="mx-auto block" />
      </div>
    </div>
  )
}

// ---- Tabelle (CSV / XLSX / ODS) -------------------------------------------

function TableDoc({ entry, source, mode }: ViewerProps & { mode: 'csv' | 'sheet' }): React.JSX.Element {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setRows(null)
    setError(null)
    setTruncated(false)
    setLoading(true)

    const parse = (ws: XLSX.WorkSheet): void => {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        blankrows: false,
        defval: ''
      })
      const isTrunc = aoa.length > MAX_ROWS
      const limited = aoa.slice(0, MAX_ROWS).map((r) => r.map((c) => (c == null ? '' : String(c))))
      setRows(limited)
      setTruncated(isTrunc)
      setLoading(false)
    }

    const run = async (): Promise<void> => {
      try {
        if (mode === 'csv') {
          const res = await window.api.preview.readText(source, CSV_MAX)
          if (!alive) return
          if (res.error) {
            setError(res.error)
            setLoading(false)
            return
          }
          const wb = XLSX.read(res.text, { type: 'string' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          parse(ws)
          // readText-Trunkierung (>1 MB) auch als Hinweis werten.
          if (res.truncated) setTruncated(true)
        } else {
          const bytes = await window.api.preview.readBytes(source)
          if (!alive) return
          if (!bytes) {
            setError('Datei konnte nicht gelesen werden (zu groß oder Fehler).')
            setLoading(false)
            return
          }
          const wb = XLSX.read(bytes, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          parse(ws)
        }
      } catch {
        if (alive) {
          setError('Tabelle konnte nicht gelesen werden.')
          setLoading(false)
        }
      }
    }
    void run()

    return () => {
      alive = false
    }
  }, [source, mode])

  if (error) return <ErrorPanel name={entry.name} message={error} />
  if (loading || !rows) return <Centered>Lädt…</Centered>
  if (rows.length === 0) return <Centered>Leere Tabelle</Centered>

  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="border-border w-full border-collapse text-sm">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-border border-b">
                {Array.from({ length: cols }).map((_, ci) => (
                  <td
                    key={ci}
                    className="border-border text-foreground border-r px-2 py-1 align-top whitespace-pre-wrap"
                  >
                    {r[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <div className="border-border text-meta text-ink-faint border-t px-4 py-2">
          … (gekürzt — nur die ersten {MAX_ROWS} Zeilen)
        </div>
      )}
    </div>
  )
}

// ---- DOCX -----------------------------------------------------------------

function DocxDoc({ entry, source }: ViewerProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHtml(null)
    setError(null)

    const run = async (): Promise<void> => {
      const bytes = await window.api.preview.readBytes(source)
      if (!alive) return
      if (!bytes) {
        setError('Datei konnte nicht gelesen werden (zu groß oder Fehler).')
        return
      }
      try {
        const arrayBuffer = bytes.slice().buffer
        const res = await mammoth.convertToHtml({ arrayBuffer })
        if (alive) setHtml(res.value)
      } catch {
        if (alive) setError('DOCX konnte nicht konvertiert werden.')
      }
    }
    void run()

    return () => {
      alive = false
    }
  }, [source])

  if (error) return <ErrorPanel name={entry.name} message={error} />
  if (html === null) return <Centered>Lädt…</Centered>

  return (
    <div className="bg-background h-full overflow-auto">
      <style>{`
        .cpp-docx { max-width: 46rem; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.6; }
        .cpp-docx p { margin: 0 0 0.75rem; }
        .cpp-docx h1, .cpp-docx h2, .cpp-docx h3 { margin: 1.25rem 0 0.5rem; font-weight: 600; }
        .cpp-docx h1 { font-size: 1.4rem; }
        .cpp-docx h2 { font-size: 1.2rem; }
        .cpp-docx h3 { font-size: 1.05rem; }
        .cpp-docx ul, .cpp-docx ol { margin: 0 0 0.75rem 1.5rem; }
        .cpp-docx li { margin: 0.2rem 0; }
        .cpp-docx table { border-collapse: collapse; margin: 0.75rem 0; }
        .cpp-docx td, .cpp-docx th { border: 1px solid var(--border); padding: 0.25rem 0.5rem; }
        .cpp-docx img { max-width: 100%; height: auto; }
        .cpp-docx a { text-decoration: underline; }
      `}</style>
      <div
        className="cpp-docx text-foreground"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

// ---- EPUB -----------------------------------------------------------------

function EpubDoc({ entry, source }: ViewerProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<ReturnType<typeof ePub> | null>(null)
  const renditionRef = useRef<ReturnType<ReturnType<typeof ePub>['renderTo']> | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setError(null)
    setLoading(true)

    const run = async (): Promise<void> => {
      const bytes = await window.api.preview.readBytes(source)
      if (!alive) return
      if (!bytes) {
        setError('Datei konnte nicht gelesen werden (zu groß oder Fehler).')
        setLoading(false)
        return
      }
      const host = hostRef.current
      if (!host) return
      try {
        const book = ePub(bytes.slice().buffer)
        bookRef.current = book
        const rendition = book.renderTo(host, { width: '100%', height: '100%' })
        renditionRef.current = rendition
        await rendition.display()
        if (alive) setLoading(false)
      } catch {
        if (alive) {
          setError('EPUB konnte nicht geöffnet werden.')
          setLoading(false)
        }
      }
    }
    void run()

    return () => {
      alive = false
      renditionRef.current?.destroy()
      renditionRef.current = null
      bookRef.current?.destroy()
      bookRef.current = null
    }
  }, [source])

  if (error) return <ErrorPanel name={entry.name} message={error} />

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="border-border flex items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void renditionRef.current?.prev()}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void renditionRef.current?.next()}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="text-ink-muted absolute inset-0 flex items-center justify-center">
            Lädt…
          </div>
        )}
        <div ref={hostRef} className="h-full" />
      </div>
    </div>
  )
}

// ---- Fallback (ODT / MOBI) ------------------------------------------------

function UnsupportedDoc({ entry }: ViewerProps): React.JSX.Element {
  return (
    <Centered>
      <div className="flex flex-col items-center gap-2">
        <FileQuestion className="text-ink-faint size-8" />
        <div className="text-foreground">Vorschau für dieses Format noch nicht verfügbar</div>
        <div className="text-meta text-ink-faint">
          {entry.name} · {formatSize(entry.size)}
        </div>
      </div>
    </Centered>
  )
}

// ---- Dispatcher -----------------------------------------------------------

export function DocumentViewer(props: ViewerProps): React.JSX.Element {
  const ext = extensionOf(props.entry.name)
  switch (ext) {
    case 'pdf':
      return <PdfDoc {...props} />
    case 'csv':
      return <TableDoc {...props} mode="csv" />
    case 'xlsx':
    case 'ods':
      return <TableDoc {...props} mode="sheet" />
    case 'docx':
      return <DocxDoc {...props} />
    case 'epub':
      return <EpubDoc {...props} />
    default:
      // odt, mobi und alles Unbekannte → bewusster „not yet"-Zustand.
      return <UnsupportedDoc {...props} />
  }
}
