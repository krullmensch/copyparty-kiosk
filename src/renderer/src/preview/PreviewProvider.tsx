import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { capabilitiesFor, categorize } from '../../../shared/filetypes'
import type { PreviewSource } from '../../../shared/types'

export type PreviewMode = 'quicklook' | 'fullview'

export interface PreviewEntry {
  name: string
  size: number
}

/** was gerade in einer Pane fokussiert ist (bei Mehrfach-Selektion: zuletzt geklickt). */
export interface ActiveSelection {
  name: string
  size: number
  isDirectory: boolean
  source: PreviewSource
}

interface PreviewContextValue {
  mode: PreviewMode | null
  entry: PreviewEntry | null
  source: PreviewSource | null
  activeSelection: ActiveSelection | null
  openQuickLook: (name: string, size: number, source: PreviewSource) => void
  openFullView: (name: string, size: number, source: PreviewSource) => void
  close: () => void
  setActiveSelection: (sel: ActiveSelection | null) => void
}

const PreviewContext = createContext<PreviewContextValue | null>(null)

export function usePreview(): PreviewContextValue {
  const ctx = useContext(PreviewContext)
  if (!ctx) throw new Error('usePreview must be used within a PreviewProvider')
  return ctx
}

export function PreviewProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [mode, setMode] = useState<PreviewMode | null>(null)
  const [entry, setEntry] = useState<PreviewEntry | null>(null)
  const [source, setSource] = useState<PreviewSource | null>(null)
  const [activeSelection, setActiveSelectionRaw] = useState<ActiveSelection | null>(null)

  const close = useCallback((): void => {
    setMode(null)
    setEntry(null)
    setSource(null)
  }, [])

  const openQuickLook = useCallback(
    (name: string, size: number, src: PreviewSource): void => {
      if (!capabilitiesFor(categorize(name)).quickLook) return
      setEntry({ name, size })
      setSource(src)
      setMode('quicklook')
    },
    []
  )

  const openFullView = useCallback(
    (name: string, size: number, src: PreviewSource): void => {
      const caps = capabilitiesFor(categorize(name))
      if (caps.fullOpen) {
        setEntry({ name, size })
        setSource(src)
        setMode('fullview')
        return
      }
      // Kategorien ohne fullOpen (program, unknown): QuickLook falls möglich, sonst no-op
      if (caps.quickLook) {
        setEntry({ name, size })
        setSource(src)
        setMode('quicklook')
      }
    },
    []
  )

  const setActiveSelection = useCallback((sel: ActiveSelection | null): void => {
    setActiveSelectionRaw(sel)
  }, [])

  const value = useMemo<PreviewContextValue>(
    () => ({
      mode,
      entry,
      source,
      activeSelection,
      openQuickLook,
      openFullView,
      close,
      setActiveSelection
    }),
    [mode, entry, source, activeSelection, openQuickLook, openFullView, close, setActiveSelection]
  )

  return (
    <PreviewContext.Provider value={value}>
      {children}
      {mode && entry && <PreviewPlaceholder mode={mode} entry={entry} onClose={close} />}
    </PreviewContext.Provider>
  )
}

/**
 * Platzhalter-Overlay bis TSK-08/09 die echten Viewer liefern.
 * Bewusst als eigene Komponente isoliert, damit die Render-Stelle klar ersetzbar bleibt.
 */
function PreviewPlaceholder({
  mode,
  entry,
  onClose
}: {
  mode: PreviewMode
  entry: PreviewEntry
  onClose: () => void
}): React.JSX.Element {
  const category = categorize(entry.name)
  const modeLabel = mode === 'quicklook' ? 'Quick Look' : 'Vollansicht'

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
        className="bg-background border-border text-foreground w-[28rem] max-w-[90vw] rounded-lg border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="border-border text-meta rounded border px-2 py-0.5 uppercase tracking-wider">
            {category}
          </span>
          <span className="text-meta text-ink-muted">{modeLabel}</span>
        </div>
        <div className="text-h2 mb-2 break-all">{entry.name}</div>
        <div className="text-meta text-ink-faint">Viewer folgt (TSK-08/09)</div>
      </div>
    </div>
  )
}
