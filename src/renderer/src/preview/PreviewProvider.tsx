import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { capabilitiesFor, categorize } from '../../../shared/filetypes'
import type { PreviewSource } from '../../../shared/types'
import { FullView } from './FullView'
import { useSuppressScreensaver } from '../screensaver/suppress'

export type PreviewMode = 'fullview'

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

  // Kein Screensaver, solange eine Medien-Vorschau offen ist.
  useSuppressScreensaver(mode !== null)

  const close = useCallback((): void => {
    setMode(null)
    setEntry(null)
    setSource(null)
  }, [])



  const openFullView = useCallback(
    (name: string, size: number, src: PreviewSource): void => {
      if (src.kind === 'local') return
      const caps = capabilitiesFor(categorize(name))
      if (caps.fullOpen || caps.quickLook) {
        setEntry({ name, size })
        setSource(src)
        setMode('fullview')
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
      openFullView,
      close,
      setActiveSelection
    }),
    [mode, entry, source, activeSelection, openFullView, close, setActiveSelection]
  )

  return (
    <PreviewContext.Provider value={value}>
      {children}
      {mode === 'fullview' && entry && source && (
        <FullView entry={entry} source={source} onClose={close} />
      )}
    </PreviewContext.Provider>
  )
}
