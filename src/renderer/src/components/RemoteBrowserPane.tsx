import { useMemo, useState } from 'react'
import { ArrowUp, File as FileIcon, Folder, LogOut, RotateCw } from 'lucide-react'
import { gooeyToast as toast } from 'goey-toast'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useRemoteListing } from '../hooks/useRemoteListing'
import { useSelection } from '../hooks/useSelection'
import { formatDate, formatSize } from '../lib/format'
import type { RemoteEntry } from '../../../shared/types'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'

interface Props {
  server: string
  onDisconnect: () => void
}

function sortEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function RemoteBrowserPane({ server, onDisconnect }: Props): React.JSX.Element {
  const [vpath, setVpath] = useState('/')
  const [dropActive, setDropActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data, error, loading, reload } = useRemoteListing(server, vpath)
  const sorted = useMemo(() => (data ? sortEntries(data.entries) : []), [data])
  const ids = useMemo(() => sorted.map((e) => e.href), [sorted])
  const sel = useSelection(ids, vpath)

  const entryVpath = (entry: RemoteEntry): string => {
    const base = vpath.endsWith('/') ? vpath : `${vpath}/`
    return `${base}${entry.href.replace(/\/$/, '')}`
  }

  const navigateTo = (entry: RemoteEntry): void => {
    if (!entry.isDirectory) return
    setVpath(entryVpath(entry))
  }

  const onRowClick = (e: React.MouseEvent, entry: RemoteEntry): void => {
    sel.click(entry.href, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
  }

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
      className={`border-border bg-card flex h-full min-h-0 flex-col rounded-lg border transition-colors ${
        dropActive ? 'border-primary ring-primary ring-2' : ''
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="border-border flex items-center gap-2 border-b p-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!data?.parent || vpath === '/'}
          onClick={() => data?.parent && setVpath(data.parent)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={reload}>
          <RotateCw className="size-4" />
        </Button>
        <div className="text-muted-foreground flex-1 truncate font-mono text-xs">
          {server}
          {vpath}
        </div>
        {data?.acct && <span className="text-muted-foreground text-xs">{data.acct}</span>}
        <Button variant="ghost" size="sm" onClick={onDisconnect} title="disconnect">
          <LogOut className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1" onClick={() => sel.clear()}>
        {(loading || busy) && !data && (
          <div className="text-muted-foreground p-4 text-sm">Loading…</div>
        )}
        {error && <div className="text-destructive p-4 text-sm">Error: {error}</div>}
        {data && sorted.length === 0 && !loading && (
          <div className="text-muted-foreground p-4 text-sm">Empty.</div>
        )}
        <ul className="divide-border divide-y">
          {sorted.map((e) => {
            const isSel = sel.selected.has(e.href)
            return (
              <li
                key={e.href}
                draggable={!e.isDirectory}
                onDragStart={(ev) => onDragStart(ev, e)}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onRowClick(ev, e)
                }}
                onDoubleClick={() => navigateTo(e)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm select-none ${
                  isSel ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
              >
                {e.isDirectory ? (
                  <Folder className="text-primary size-4 shrink-0" />
                ) : (
                  <FileIcon className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className="flex-1 truncate">{e.name}</span>
                <span className="text-muted-foreground w-20 text-right text-xs">
                  {e.isDirectory ? '' : formatSize(e.size)}
                </span>
                <span className="text-muted-foreground w-16 text-right text-xs">
                  {formatDate(e.ts)}
                </span>
              </li>
            )
          })}
        </ul>
      </ScrollArea>

      <div className="border-border text-muted-foreground border-t px-3 py-1.5 text-xs">
        {busy
          ? 'Transferring…'
          : sel.selected.size > 0
            ? `${sel.selected.size} of ${sorted.length} selected`
            : `${sorted.length} item${sorted.length === 1 ? '' : 's'}`}
        {data?.perms && data.perms.length > 0 && !busy && sel.selected.size === 0 && (
          <span className="ml-2">· {data.perms.join(', ')}</span>
        )}
      </div>
    </div>
  )
}
