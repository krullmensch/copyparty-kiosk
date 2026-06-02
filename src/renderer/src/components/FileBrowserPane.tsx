import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, File as FileIcon, Folder, RotateCw, Search, X } from 'lucide-react'
import { gooeyToast as toast } from 'goey-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { LocalThumb } from '@/components/ui/local-thumb'
import { Filename } from '@/components/ui/filename'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { useListing } from '../hooks/useListing'
import { useSelection } from '../hooks/useSelection'
import { formatDate, formatSize } from '../lib/format'
import type { FileEntry, FsSearchHit } from '../../../shared/types'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'

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

function sortEntries(entries: FileEntry[], showHidden: boolean): FileEntry[] {
  const filtered = showHidden ? entries : entries.filter((e) => !e.hidden)
  return [...filtered].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function FileBrowserPane({ rootPath }: Props): React.JSX.Element {
  const [cwd, setCwd] = useState(rootPath)
  const [showHidden, setShowHidden] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [query, setQuery] = useState('')
  const [searchHits, setSearchHits] = useState<FsSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const { data, error, loading, reload } = useListing(cwd)

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

  const sorted = useMemo(() => (data ? sortEntries(data.entries, showHidden) : []), [data, showHidden])
  const ids = useMemo(() => sorted.map((e) => e.path), [sorted])
  const sel = useSelection(ids, cwd)

  const onRowClick = (e: React.MouseEvent, entry: FileEntry): void => {
    sel.click(entry.path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
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

  return (
    <div
      className={`border-border bg-bg-surface flex h-full min-h-0 flex-col rounded-card border transition-colors ${
        dropActive ? 'border-accent ring-accent ring-2' : ''
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="border-border flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!data?.parent || inSearch}
            onClick={() => data?.parent && setCwd(data.parent)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={reload}>
            <RotateCw className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <Breadcrumbs segments={buildSegments(rootPath, cwd, setCwd)} />
          </div>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHidden((v) => !v)}
            title="toggle hidden"
          >
            {showHidden ? '.✓' : '.×'}
          </Button>
        </div>
        <div className="relative">
          <Search className="text-ink-faint absolute left-2 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Suche in ${rootPath.split('/').filter(Boolean).pop() ?? rootPath}…`}
            className="text-meta h-8 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-ink-muted hover:text-ink absolute right-2 top-1/2 -translate-y-1/2"
              title="clear"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1" onClick={() => sel.clear()}>
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
                      className="text-filename-list hover:bg-bg-surface-hover flex cursor-pointer items-center gap-3 px-3 py-1.5 select-none"
                    >
                      <div className="rounded-thumb relative flex size-8 shrink-0 items-center justify-center overflow-hidden bg-bg-page-tint">
                        {h.isDirectory ? (
                          <Folder className="text-ink size-4" />
                        ) : (
                          <LocalThumb
                            path={h.path}
                            name={h.name}
                            className="h-full w-full object-cover"
                            fallback={<FileIcon className="text-ink-muted size-4" />}
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
          <ul className="divide-border divide-y">
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
                  onDoubleClick={() => e.isDirectory && setCwd(e.path)}
                  className={`text-filename-list flex cursor-pointer items-center gap-3 px-3 py-1.5 select-none ${
                    isSel ? 'bg-accent text-ink-leaf' : 'hover:bg-bg-surface-hover'
                  }`}
                >
                  <div className="rounded-thumb relative flex size-8 shrink-0 items-center justify-center overflow-hidden bg-bg-page-tint">
                    {e.isDirectory ? (
                      <Folder className={`size-4 ${isSel ? 'text-ink-leaf' : 'text-ink'}`} />
                    ) : (
                      <LocalThumb
                        path={e.path}
                        name={e.name}
                        className="h-full w-full object-cover"
                        fallback={
                          <FileIcon className={`size-4 ${isSel ? 'text-ink-leaf' : 'text-ink-muted'}`} />
                        }
                      />
                    )}
                  </div>
                  <Filename name={e.name} isDirectory={e.isDirectory} className="flex-1" />
                  <span className={`text-meta w-20 text-right ${isSel ? 'text-ink-leaf' : 'text-ink-muted'}`}>
                    {e.isDirectory ? '' : formatSize(e.size)}
                  </span>
                  <span className={`text-meta w-16 text-right ${isSel ? 'text-ink-leaf' : 'text-ink-muted'}`}>
                    {formatDate(e.mtime)}
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
                  onDoubleClick={() => e.isDirectory && setCwd(e.path)}
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
                        strokeWidth={1.25}
                      />
                    ) : (
                      <LocalThumb
                        path={e.path}
                        name={e.name}
                        className="h-full w-full object-cover"
                        fallback={
                          <FileIcon
                            className={`size-10 ${isSel ? 'text-ink-leaf' : 'text-ink-muted'}`}
                            strokeWidth={1.25}
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
      </ScrollArea>

      <div className="border-border text-ink-muted text-meta border-t px-3 py-1.5">
        {busy
          ? 'Transferring…'
          : sel.selected.size > 0
            ? `${sel.selected.size} of ${sorted.length} selected`
            : `${sorted.length} item${sorted.length === 1 ? '' : 's'}`}
      </div>
    </div>
  )
}
