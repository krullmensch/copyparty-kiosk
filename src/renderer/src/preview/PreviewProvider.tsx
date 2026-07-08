import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { capabilitiesFor, categorize } from '../../../shared/filetypes'
import type { PreviewSource } from '../../../shared/types'
import { QuickLookOverlay } from './QuickLookOverlay'
import { FullView } from './FullView'

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
      {mode === 'quicklook' && entry && source && (
        <QuickLookOverlay entry={entry} source={source} onClose={close} />
      )}
      {mode === 'fullview' && entry && source && (
        <FullView entry={entry} source={source} onClose={close} />
      )}
    </PreviewContext.Provider>
  )
}
