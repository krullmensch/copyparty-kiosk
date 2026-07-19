import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Folder,
  LogOut,
  RotateCw,
  Search,
  Upload,
  X
} from 'lucide-react'
import { gooeyToast as toast } from 'goey-toast'
import { Chip, IconPill } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { RemoteThumb } from '@/components/ui/remote-thumb'
import { FileTypeIcon } from '@/components/ui/file-icon'
import { Filename } from '@/components/ui/filename'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { QrShareDialog, type QrShareItem } from './QrShareDialog'
import { useRemoteListing } from '../hooks/useRemoteListing'
import { useSelection } from '../hooks/useSelection'
import { usePreview } from '../preview/PreviewProvider'
import { formatSize } from '../lib/format'
import { compareBy, type SortDir, type SortField } from '../lib/sort'
import type { CppSearchHit, RemoteEntry } from '../../../shared/types'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'

/** Same rule copyparty enforces server-side (see share.ts validateShareItems):
 *  at most 1 folder, never mixed with files. Mirrored here (same texts, same
 *  order) to disable the menu item up-front instead of round-tripping to
 *  main for a 400. */
function shareDisabledReason(targets: RemoteEntry[]): string | null {
  if (targets.length === 0) return 'Keine Dateien ausgewählt'
  const dirs = targets.filter((t) => t.isDirectory)
  if (dirs.length > 1) return 'Mehrere Ordner lassen sich nicht zusammen teilen'
  if (dirs.length > 0 && dirs.length !== targets.length) {
    return 'Ordner und Dateien lassen sich nicht zusammen teilen'
  }
  return null
}

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
  vpath: string,
  setVpath: (p: string) => void
): { label: string; onClick?: () => void }[] {
  const parts = vpath.split('/').filter(Boolean)
  const segs = [{ label: 'Agora', onClick: () => setVpath('/') }]
  parts.forEach((p, i) => {
    const target = '/' + parts.slice(0, i + 1).join('/')
    segs.push({ label: p, onClick: () => setVpath(target) })
  })
  return segs
}

interface Props {
  server: string
  onDisconnect?: () => void
}

function sortEntries(entries: RemoteEntry[], field: SortField, dir: SortDir): RemoteEntry[] {
  const cmp = compareBy(field, dir)
  return [...entries].sort((a, b) =>
    cmp(
      { name: a.name, size: a.size, mtime: a.ts, isDirectory: a.isDirectory },
      { name: b.name, size: b.size, mtime: b.ts, isDirectory: b.isDirectory }
    )
  )
}

export function RemoteBrowserPane({ server, onDisconnect }: Props): React.JSX.Element {
  const [vpath, setVpath] = useState('/')
  const [dropActive, setDropActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shareItems, setShareItems] = useState<QrShareItem[] | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [query, setQuery] = useState('')
  const [searchHits, setSearchHits] = useState<CppSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const { data, error, loading, reload } = useRemoteListing(server, vpath)

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
      const res = await window.api.cpp.search(server, q)
      if (cancelled) return
      setSearchHits(res.hits)
      setSearchTruncated(res.truncated)
      setSearching(false)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, server])

  const inSearch = searchHits !== null
  const sorted = useMemo(
    () => (data ? sortEntries(data.entries, sortField, sortDir) : []),
    [data, sortField, sortDir]
  )
  const ids = useMemo(() => sorted.map((e) => e.href), [sorted])
  const sel = useSelection(ids, vpath)
  const { setActiveSelection, openFullView } = usePreview()

  const entryVpath = (entry: RemoteEntry): string => {
    const base = vpath.endsWith('/') ? vpath : `${vpath}/`
    return `${base}${entry.href.replace(/\/$/, '')}`
  }

  // zuletzt geklickten Eintrag als aktive Preview-Selektion melden
  useEffect(() => {
    const id = sel.lastClicked
    const entry = id ? sorted.find((e) => e.href === id) : undefined
    if (!entry) {
      setActiveSelection(null)
      return
    }
    const base = vpath.endsWith('/') ? vpath : `${vpath}/`
    const evp = `${base}${entry.href.replace(/\/$/, '')}`
    setActiveSelection({
      name: entry.name,
      size: entry.size,
      isDirectory: entry.isDirectory,
      source: { kind: 'remote', server, vpath: evp }
    })
  }, [sel.lastClicked, sorted, setActiveSelection, server, vpath])

  const navigateTo = (entry: RemoteEntry): void => {
    if (!entry.isDirectory) return
    setVpath(entryVpath(entry))
  }

  const onEntryDoubleClick = (entry: RemoteEntry): void => {
    if (entry.isDirectory) {
      navigateTo(entry)
    } else {
      openFullView(entry.name, entry.size, {
        kind: 'remote',
        server,
        vpath: entryVpath(entry)
      })
    }
  }

  const onRowClick = (e: React.MouseEvent, entry: RemoteEntry): void => {
    sel.click(entry.href, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
  }

  // right-click on a row outside the current selection selects it first
  // (standard file-manager behaviour), then the menu acts on the selection
  const onEntryContextMenu = (entry: RemoteEntry): void => {
    if (!sel.selected.has(entry.href)) {
      sel.click(entry.href, { shift: false, meta: false })
    }
  }

  const shareTargetsFor = (entry: RemoteEntry): RemoteEntry[] =>
    sel.selected.has(entry.href) ? sorted.filter((x) => sel.selected.has(x.href)) : [entry]

  const toShareItems = (targets: RemoteEntry[]): QrShareItem[] =>
    targets.map((t) => ({
      vpath: entryVpath(t),
      name: t.name,
      size: t.size,
      isDirectory: t.isDirectory
    }))

  const onDragStart = (e: React.DragEvent, entry: RemoteEntry): void => {
    if (entry.isDirectory) {
      e.preventDefault()
      return
    }
    let items: RemoteEntry[]
    if (sel.selected.has(entry.href)) {
      items = sorted.filter((x) => !x.isDirectory && sel.selected.has(x.href))
    } else {
      sel.setSelected(new Set([entry.href]))
      items = [entry]
    }
    const payload: DragPayload = {
      kind: 'remote',
      server,
      vpaths: items.map((x) => entryVpath(x)),
      names: items.map((x) => x.name)
    }
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
    if (payload.kind !== 'local') return

    setBusy(true)
    const res = await window.api.cpp.upload(server, vpath, payload.paths)
    setBusy(false)
    if (res.ok) {
      toast.success(`Uploaded ${res.done} file(s)`)
      reload()
    } else {
      toast.error(`Upload failed (${res.done}/${res.total}): ${res.message ?? 'unknown'}`)
      if (res.done > 0) reload()
    }
  }

  return (
    <div
      className={`border-ink bg-bg-surface flex h-full min-h-0 flex-col rounded-container border transition-colors ${
        dropActive ? 'ring-ink/40 ring-2' : ''
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <IconPill onClick={reload} title="Neu laden" aria-label="Neu laden">
          <RotateCw />
        </IconPill>
        <IconPill
          disabled={!data?.parent || vpath === '/' || inSearch}
          onClick={() => data?.parent && setVpath(data.parent)}
          title="Zurück"
          aria-label="Eine Ebene zurück"
        >
          <ArrowLeft />
        </IconPill>
        <div className="min-w-0">
          <Breadcrumbs segments={buildSegments(vpath, setVpath)} />
        </div>
        <div className="relative min-w-[10rem] flex-1">
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
              <X className="size-4" />
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
        {onDisconnect && (
          <IconPill onClick={onDisconnect} title="Verbindung trennen" aria-label="Verbindung trennen">
            <LogOut />
          </IconPill>
        )}
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
                    <ContextMenu key={h.vpath}>
                      <ContextMenuTrigger asChild>
                        <li
                          onClick={() => {
                            const target = h.isDirectory
                              ? h.vpath
                              : h.vpath.replace(/\/[^/]+$/, '') || '/'
                            setVpath(target.endsWith('/') ? target : target)
                            setQuery('')
                          }}
                          className="text-filename-list hover:bg-bg-surface-hover flex cursor-pointer items-center gap-3 px-3 py-1.5 select-none"
                        >
                          <div className="rounded-thumb relative flex size-8 shrink-0 items-center justify-center overflow-hidden bg-bg-page-tint">
                            {h.isDirectory ? (
                              <Folder className="text-ink size-4" />
                            ) : (
                              <RemoteThumb
                                server={server}
                                vpath={h.vpath}
                                name={h.name}
                                className="h-full w-full object-cover"
                                fallback={<FileTypeIcon name={h.name} className="text-ink-muted size-4" />}
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <Filename name={h.name} isDirectory={h.isDirectory} />
                            <div className="text-ink-faint text-meta truncate">
                              {h.vpath.split('/').slice(0, -1).join('/') || '/'}
                            </div>
                          </div>
                          <span className="text-ink-muted text-meta w-20 text-right">
                            {h.isDirectory ? '' : formatSize(h.size)}
                          </span>
                        </li>
                      </ContextMenuTrigger>
                      <ContextMenuContent onClick={(ev) => ev.stopPropagation()}>
                        <ContextMenuItem
                          disabled={h.isDirectory}
                          title={
                            h.isDirectory
                              ? 'Ordner aus der Suche nur einzeln aus dem Ordner heraus teilbar'
                              : undefined
                          }
                          onSelect={() =>
                            setShareItems([
                              { vpath: h.vpath, name: h.name, size: h.size, isDirectory: h.isDirectory }
                            ])
                          }
                        >
                          Auf Smartphone laden
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
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
              const isSel = sel.selected.has(e.href)
              const shareTargets = shareTargetsFor(e)
              const shareDisabled = shareDisabledReason(shareTargets)
              return (
                <ContextMenu key={e.href}>
                  <ContextMenuTrigger asChild>
                    <li
                      draggable={!e.isDirectory}
                      onDragStart={(ev) => onDragStart(ev, e)}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onRowClick(ev, e)
                      }}
                      onDoubleClick={() => onEntryDoubleClick(e)}
                      onContextMenu={() => onEntryContextMenu(e)}
                      className={`text-body flex cursor-pointer items-center gap-3 rounded-input px-4 py-2.5 font-medium select-none transition-colors ${
                        isSel
                          ? 'bg-ink text-ink-leaf'
                          : 'bg-bg-page-tint text-ink hover:bg-bg-surface-hover'
                      }`}
                    >
                      {e.isDirectory && (
                        <Folder
                          className={`size-4 shrink-0 ${isSel ? 'text-ink-leaf' : 'text-ink'}`}
                        />
                      )}
                      <Filename name={e.name} isDirectory={e.isDirectory} className="flex-1" />
                      <span className={`shrink-0 text-right ${isSel ? 'text-ink-leaf' : 'text-ink'}`}>
                        {e.isDirectory ? '' : formatSize(e.size)}
                      </span>
                    </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent onClick={(ev) => ev.stopPropagation()}>
                    <ContextMenuItem
                      disabled={!!shareDisabled}
                      title={shareDisabled ?? undefined}
                      onSelect={() => setShareItems(toShareItems(shareTargets))}
                    >
                      Auf Smartphone laden
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </ul>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 p-3">
            {sorted.map((e) => {
              const isSel = sel.selected.has(e.href)
              const shareTargets = shareTargetsFor(e)
              const shareDisabled = shareDisabledReason(shareTargets)
              return (
                <ContextMenu key={e.href}>
                  <ContextMenuTrigger asChild>
                    <li
                      draggable={!e.isDirectory}
                      onDragStart={(ev) => onDragStart(ev, e)}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onRowClick(ev, e)
                      }}
                      onDoubleClick={() => onEntryDoubleClick(e)}
                      onContextMenu={() => onEntryContextMenu(e)}
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
                          <RemoteThumb
                            server={server}
                            vpath={entryVpath(e)}
                            name={e.name}
                            className="h-full w-full object-cover"
                            fallback={
                              <FileTypeIcon
                                name={e.name}
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
                  </ContextMenuTrigger>
                  <ContextMenuContent onClick={(ev) => ev.stopPropagation()}>
                    <ContextMenuItem
                      disabled={!!shareDisabled}
                      title={shareDisabled ?? undefined}
                      onSelect={() => setShareItems(toShareItems(shareTargets))}
                    >
                      Auf Smartphone laden
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="relative flex items-center justify-center px-4 py-3">
        <span className="text-ink-muted text-meta absolute left-4">
          {busy
            ? 'Transferring…'
            : sel.selected.size > 0
              ? `${sel.selected.size} von ${sorted.length} ausgewählt`
              : `${sorted.length} Objekt${sorted.length === 1 ? '' : 'e'}`}
        </span>
        <button
          type="button"
          disabled={sel.selected.size === 0}
          onClick={() => {
            const picked = sorted.filter((e) => sel.selected.has(e.href))
            if (picked.length > 0) setShareItems(toShareItems(picked))
          }}
          className="text-body inline-flex items-center gap-2 rounded-pill bg-ink px-6 py-2.5 font-medium text-ink-leaf transition-opacity outline-none hover:opacity-90 disabled:opacity-40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Upload className="size-4" />
          Datentausch
        </button>
      </div>

      {shareItems && (
        <QrShareDialog server={server} items={shareItems} onClose={() => setShareItems(null)} />
      )}
    </div>
  )
}
