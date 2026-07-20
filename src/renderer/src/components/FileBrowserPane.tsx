import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, EyeClosed, Folder, RefreshDouble, Search, Xmark } from 'iconoir-react'
import { gooeyToast as toast } from 'goey-toast'
import { Chip, IconPill } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { LocalThumb } from '@/components/ui/local-thumb'
import { FileTypeIcon } from '@/components/ui/file-icon'
import { Filename } from '@/components/ui/filename'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { useListing } from '../hooks/useListing'
import { useSelection } from '../hooks/useSelection'
import { usePreview } from '../preview/PreviewProvider'
import { useTransferProgress } from '../hooks/useTransferProgress'
import { formatSize } from '../lib/format'
import { compareBy, type SortDir, type SortField } from '../lib/sort'
import type { FileEntry, FsSearchHit } from '../../../shared/types'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'size', label: 'Größe' },
  { field: 'mtime', label: 'Datum' },
  { field: 'ext', label: 'Format' }
]

interface SortControlProps {
  field: SortField
  dir: SortDir
  onChange: (field: SortField, dir: SortDir) => void
}

function SortControl({ field, dir, onChange }: SortControlProps): React.JSX.Element {
  return (
    <div className="inline-flex items-center gap-1.5">
      <IconPill
        onClick={() => onChange(field, dir === 'asc' ? 'desc' : 'asc')}
        title={dir === 'asc' ? 'aufsteigend' : 'absteigend'}
        aria-label="Sortierrichtung umschalten"
      >
        {dir === 'asc' ? <ArrowUp /> : <ArrowDown />}
      </IconPill>
      {SORT_FIELDS.map((f) => {
        const active = f.field === field
        return (
          <Chip
            key={f.field}
            active={active}
            onClick={() => onChange(f.field, active ? (dir === 'asc' ? 'desc' : 'asc') : 'asc')}
          >
            {f.label}
          </Chip>
        )
      })}
    </div>
  )
}

function buildSegments(
  rootPath: string,
  cwd: string,
  setCwd: (p: string) => void
): { label: string; onClick?: () => void }[] {
  const rootName = rootPath.split('/').filter(Boolean).pop() ?? rootPath
  const rel = cwd === rootPath
    ? ''
    : cwd.startsWith(rootPath + '/')
      ? cwd.slice(rootPath.length + 1)
      : cwd
  const parts = rel ? rel.split('/').filter(Boolean) : []
  const segs = [{ label: rootName, onClick: () => setCwd(rootPath) }]
  parts.forEach((p, i) => {
    const target = rootPath + '/' + parts.slice(0, i + 1).join('/')
    segs.push({ label: p, onClick: () => setCwd(target) })
  })
  return segs
}

interface Props {
  rootPath: string
}

function sortEntries(
  entries: FileEntry[],
  showHidden: boolean,
  field: SortField,
  dir: SortDir
): FileEntry[] {
  const filtered = showHidden ? entries : entries.filter((e) => !e.hidden)
  return [...filtered].sort(compareBy(field, dir))
}

export function FileBrowserPane({ rootPath }: Props): React.JSX.Element {
  const [cwd, setCwd] = useState(rootPath)
  const [showHidden, setShowHidden] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [query, setQuery] = useState('')
  const [searchHits, setSearchHits] = useState<FsSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const { data, error, loading, reload } = useListing(cwd)
  const transfers = useTransferProgress()

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setSearchHits(null)
      setSearchTruncated(false)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await window.api.fs.search(rootPath, q)
      if (cancelled) return
      setSearchHits(res.hits)
      setSearchTruncated(res.truncated)
      setSearching(false)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, rootPath])

  const inSearch = searchHits !== null

  const sorted = useMemo(
    () => (data ? sortEntries(data.entries, showHidden, sortField, sortDir) : []),
    [data, showHidden, sortField, sortDir]
  )
  const ids = useMemo(() => sorted.map((e) => e.path), [sorted])
  const sel = useSelection(ids, cwd)
  const { setActiveSelection, openFullView } = usePreview()

  // zuletzt geklickten Eintrag als aktive Preview-Selektion melden (kein Ordner-Filter, Ordner werden mitgemeldet)
  useEffect(() => {
    const id = sel.lastClicked
    const entry = id ? sorted.find((e) => e.path === id) : undefined
    if (!entry) {
      setActiveSelection(null)
      return
    }
    setActiveSelection({
      name: entry.name,
      size: entry.size,
      isDirectory: entry.isDirectory,
      source: { kind: 'local', path: entry.path }
    })
  }, [sel.lastClicked, sorted, setActiveSelection])

  const onRowClick = (e: React.MouseEvent, entry: FileEntry): void => {
    sel.click(entry.path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
  }

  const onEntryDoubleClick = (entry: FileEntry): void => {
    if (entry.isDirectory) {
      setCwd(entry.path)
    } else {
      openFullView(entry.name, entry.size, { kind: 'local', path: entry.path })
    }
  }

  const onDragStart = (e: React.DragEvent, entry: FileEntry): void => {
    let items: FileEntry[]
    if (sel.selected.has(entry.path)) {
      items = sorted.filter((x) => sel.selected.has(x.path))
    } else {
      sel.setSelected(new Set([entry.path]))
      items = [entry]
    }
    const payload: DragPayload = { kind: 'local', paths: items.map((x) => x.path) }
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.setData('text/plain', items.map((x) => x.name).join('\n'))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const acceptsDrop = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes(DRAG_MIME)

  const onDragOver = (e: React.DragEvent): void => {
    if (!acceptsDrop(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const onDragLeave = (e: React.DragEvent): void => {
    if (e.currentTarget === e.target) setDropActive(false)
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    setDropActive(false)
    if (!acceptsDrop(e)) return
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const payload = JSON.parse(raw) as DragPayload
    if (payload.kind !== 'remote') return

    setBusy(true)
    const items = payload.vpaths.map((vp, i) => ({ vpath: vp, name: payload.names[i] }))
    const res = await window.api.cpp.download(payload.server, cwd, items)
    setBusy(false)
    if (res.ok) {
      toast.success(`Downloaded ${res.done} file(s)`)
      reload()
    } else {
      toast.error(`Download failed (${res.done}/${res.total}): ${res.message ?? 'unknown'}`)
      if (res.done > 0) reload()
    }
  }

  const [isSpinning, setIsSpinning] = useState(false)
  const handleReload = () => {
    setIsSpinning(true)
    reload()
    setTimeout(() => setIsSpinning(false), 500)
  }

  return (
    <div
      className={`bg-bg-surface grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] transition-colors ${
        dropActive ? 'ring-ink/40 -ring-offset-2 ring-2' : ''
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-3 p-4">
        <IconPill onClick={handleReload} title="Neu laden" aria-label="Neu laden">
          <RefreshDouble className={isSpinning ? 'animate-[spin_0.5s_ease-out]' : ''} />
        </IconPill>
        <IconPill
          disabled={!data?.parent || inSearch}
          onClick={() => data?.parent && setCwd(data.parent)}
          title="Zurück"
          aria-label="Eine Ebene zurück"
        >
          <ArrowLeft />
        </IconPill>
        <Breadcrumbs segments={buildSegments(rootPath, cwd, setCwd)} />
        <div className="relative min-w-80 flex-1">
          <Search className="text-ink-muted pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suche…"
            className="text-label h-9 rounded-pill border-ink pl-10 pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-ink-muted hover:text-ink absolute right-3 top-1/2 -translate-y-1/2"
              title="Suche leeren"
            >
              <Xmark className="size-4" />
            </button>
          )}
        </div>
        <SortControl
          field={sortField}
          dir={sortDir}
          onChange={(f, d) => {
            setSortField(f)
            setSortDir(d)
          }}
        />
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <IconPill
          onClick={() => setShowHidden((v) => !v)}
          title="Versteckte Dateien"
          aria-label="Versteckte Dateien umschalten"
          className={showHidden ? 'bg-ink text-ink-leaf' : ''}
        >
          <EyeClosed />
        </IconPill>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => sel.clear()}>
        {(loading || busy || searching) && !data && (
          <div className="text-ink-muted text-label p-4">Loading…</div>
        )}
        {error && <div className="text-destructive text-label p-4">Error: {error}</div>}
        {inSearch ? (
          <>
            {searching && (
              <div className="text-ink-muted text-label p-4">Suche…</div>
            )}
            {!searching && searchHits!.length === 0 && (
              <div className="text-ink-faint text-label p-4">Keine Treffer.</div>
            )}
            {!searching && searchHits!.length > 0 && (
              <>
                {searchTruncated && (
                  <div className="text-ink-faint text-meta px-3 py-2">
                    Mehr als {searchHits!.length} Treffer — nur erste angezeigt.
                  </div>
                )}
                <ul className="divide-border divide-y">
                  {searchHits!.map((h) => (
                    <li
                      key={h.path}
                      onDoubleClick={() => {
                        const target = h.isDirectory ? h.path : h.path.replace(/\/[^/]+$/, '') || rootPath
                        setCwd(target)
                        setQuery('')
                      }}
                      onClick={() => {
                        const target = h.isDirectory ? h.path : h.path.replace(/\/[^/]+$/, '') || rootPath
                        setCwd(target)
                        setQuery('')
                      }}
                      className="text-filename-list hover:bg-ink hover:text-bg-page flex cursor-pointer items-center gap-3 px-3 py-1.5 select-none"
                    >
                      <div className="rounded-thumb relative flex size-8 shrink-0 items-center justify-center overflow-hidden bg-bg-page-tint">
                        {h.isDirectory ? (
                          <Folder className="text-ink size-4" />
                        ) : (
                          <LocalThumb
                            path={h.path}
                            name={h.name}
                            className="h-full w-full object-cover"
                            fallback={<FileTypeIcon name={h.name} className="text-ink-muted size-4" />}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Filename name={h.name} isDirectory={h.isDirectory} />
                        <div className="text-ink-faint text-meta truncate">
                          {h.relPath.split('/').slice(0, -1).join('/') || '.'}
                        </div>
                      </div>
                      <span className="text-ink-muted text-meta w-20 text-right">
                        {h.isDirectory ? '' : formatSize(h.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : data && sorted.length === 0 && !loading ? (
          <div className="text-ink-faint text-label p-4">Empty.</div>
        ) : !data ? null : viewMode === 'list' ? (
          <ul className="flex flex-col gap-1 px-3 py-2">
            {sorted.map((e) => {
              const isSel = sel.selected.has(e.path)
              return (
                <li
                  key={e.path}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, e)}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onRowClick(ev, e)
                  }}
                  onDoubleClick={() => onEntryDoubleClick(e)}
                  className={`text-body group relative overflow-hidden flex cursor-pointer items-center gap-3 rounded-input px-4 py-2.5 font-medium select-none transition-colors ${
                    isSel
                      ? 'bg-ink text-ink-leaf'
                      : 'bg-bg-surface text-ink hover:bg-ink hover:text-bg-page even:bg-bg-page-tint'
                  }`}
                >
                  {transfers[e.name] && (
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 bg-white mix-blend-difference transition-[width] duration-300 ease-out z-10"
                      style={{ width: `${Math.min(100, (transfers[e.name].bytesDone / transfers[e.name].bytesTotal) * 100)}%` }}
                    />
                  )}
                  {e.isDirectory && (
                    <Folder className={`size-4 shrink-0 ${isSel ? 'text-ink-leaf' : 'text-ink group-hover:text-bg-page'}`} />
                  )}
                  <Filename name={e.name} isDirectory={e.isDirectory} className="flex-1" />
                  <span className={`shrink-0 text-right ${isSel ? 'text-ink-leaf' : 'text-ink'}`}>
                    {e.isDirectory ? '' : formatSize(e.size)}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 p-3">
            {sorted.map((e) => {
              const isSel = sel.selected.has(e.path)
              return (
                <li
                  key={e.path}
                  draggable
                  onDragStart={(ev) => onDragStart(ev, e)}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onRowClick(ev, e)
                  }}
                  onDoubleClick={() => onEntryDoubleClick(e)}
                  className={`group flex cursor-pointer flex-col items-stretch gap-2 p-2 select-none rounded-card transition-colors ${
                    isSel ? 'bg-accent text-ink-leaf' : 'hover:bg-bg-surface-hover'
                  }`}
                >
                  <div
                    className={`rounded-thumb relative flex aspect-square items-center justify-center overflow-hidden ${
                      isSel ? 'bg-ink-leaf/15' : 'bg-bg-page-tint group-hover:bg-bg-page'
                    }`}
                  >
                    {e.isDirectory ? (
                      <Folder
                        className={`size-10 ${isSel ? 'text-ink-leaf' : 'text-ink'}`}
                        strokeWidth={2}
                      />
                    ) : (
                      <LocalThumb
                        path={e.path}
                        name={e.name}
                        className="h-full w-full object-cover"
                        fallback={
                          <FileTypeIcon
                            name={e.name}
                            className={`size-10 ${isSel ? 'text-ink-leaf' : 'text-ink-muted'}`}
                            strokeWidth={2}
                          />
                        }
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <Filename
                      name={e.name}
                      isDirectory={e.isDirectory}
                      className="text-filename-card"
                    />
                    <div
                      className={`text-meta truncate ${isSel ? 'text-ink-leaf' : 'text-ink-faint'}`}
                    >
                      {e.isDirectory ? '—' : formatSize(e.size)}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
