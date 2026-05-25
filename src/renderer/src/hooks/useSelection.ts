import { useCallback, useEffect, useState } from 'react'

interface SelectionClickOpts {
  shift: boolean
  meta: boolean
}

export interface UseSelection {
  selected: Set<string>
  lastClicked: string | null
  click: (id: string, opts: SelectionClickOpts) => void
  setSelected: (s: Set<string>) => void
  clear: () => void
  selectAll: () => void
}

export function useSelection(ids: string[], resetKey: unknown): UseSelection {
  const [selected, setSelectedRaw] = useState<Set<string>>(new Set())
  const [lastClicked, setLastClicked] = useState<string | null>(null)

  useEffect(() => {
    setSelectedRaw(new Set())
    setLastClicked(null)
  }, [resetKey])

  const click = useCallback(
    (id: string, opts: SelectionClickOpts): void => {
      if (opts.shift && lastClicked) {
        const a = ids.indexOf(lastClicked)
        const b = ids.indexOf(id)
        if (a >= 0 && b >= 0) {
          const [start, end] = a < b ? [a, b] : [b, a]
          setSelectedRaw(new Set(ids.slice(start, end + 1)))
          return
        }
      }
      if (opts.meta) {
        setSelectedRaw((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        setLastClicked(id)
        return
      }
      setSelectedRaw(new Set([id]))
      setLastClicked(id)
    },
    [ids, lastClicked]
  )

  return {
    selected,
    lastClicked,
    click,
    setSelected: setSelectedRaw,
    clear: () => {
      setSelectedRaw(new Set())
      setLastClicked(null)
    },
    selectAll: () => setSelectedRaw(new Set(ids))
  }
}
