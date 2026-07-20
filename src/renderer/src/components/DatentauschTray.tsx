import { useEffect, useState } from 'react'
import { NavArrowUp, NavArrowDown, Eject, Send, Xmark, FireFlame, CompactDisc } from 'iconoir-react'
import { gooeyToast as toast } from 'goey-toast'
import { IconPill } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { FileBrowserPane } from './FileBrowserPane'
import { MobileUploadPanel } from './MobileUploadPanel'
import { QrShareDialog, type QrShareItem } from './QrShareDialog'
import { DRAG_MIME, type DragPayload } from '../../../shared/dragdrop'
import type { DriveInfo, BurnSources } from '../../../shared/types'
import { BurnDialog } from './BurnDialog'
import { RipDialog } from './RipDialog'
import { CdRipDialog } from './CdRipDialog'

interface Props {
  /** copyparty-Server-URL (für Share); null solange nicht verbunden. */
  server: string | null
  /** Mount-Pfad des USB-Sticks; null = kein Stick → Smartphone/Share-Modus. */
  usbPath: string | null
  usbLabel: string | null
  /** Optional blank optical drive available for burning. */
  burnDrive?: DriveInfo | null
  isVideoDvd?: boolean
  dataDrive?: DriveInfo | null
  audioCdDrive?: DriveInfo | null
  /** Der obere Inhalt (Remote-Pane). */
  children: React.ReactNode
}

/** Im Tray gestagte Datei (aus Remote-Drag). Nur Dateien (keine Ordner). */
interface StagedItem {
  vpath: string
  name: string
}

/**
 * Container-Shell des Homescreens: oben der Remote-Pane, darüber slidet von
 * unten ein Tray ein. Zwei Modi:
 *  - USB steckt → Tray zeigt die USB-Datei-Ansicht (FileBrowserPane), öffnet
 *    automatisch, Bottom-Bar = Auswerfen + Stick-Name.
 *  - kein USB → „Smartphone"-Modus: Tray per Datentausch-Button auf/zu,
 *    Dateien reinziehen staged sie, „Senden" teilt sie per QR aufs Handy.
 */
export function DatentauschTray({ server, usbPath, usbLabel, burnDrive, isVideoDvd, dataDrive, audioCdDrive, children }: Props): React.JSX.Element {
  const usbMode = usbPath !== null || audioCdDrive !== undefined && audioCdDrive !== null
  const [open, setOpen] = useState(false)
  const [staged, setStaged] = useState<StagedItem[]>([])
  const [shareItems, setShareItems] = useState<QrShareItem[] | null>(null)
  const [burnSources, setBurnSources] = useState<BurnSources | null>(null)
  const [ripOpen, setRipOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [ejecting, setEjecting] = useState(false)

  // USB steckt → Tray automatisch öffnen; abgezogen → schließen + Staging leeren.
  useEffect(() => {
    if (usbMode) {
      setOpen(true)
    } else {
      setOpen(false)
      setStaged([])
    }
  }, [usbMode])

  const addStaged = (payload: DragPayload): void => {
    if (payload.kind !== 'remote') return
    setStaged((prev) => {
      const seen = new Set(prev.map((s) => s.vpath))
      const next = [...prev]
      payload.vpaths.forEach((vp, i) => {
        if (!seen.has(vp)) next.push({ vpath: vp, name: payload.names[i] ?? vp })
      })
      return next
    })
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropActive(false)
    if (usbMode) return
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as DragPayload
      if (payload.kind === 'remote' && payload.vpaths.length > 0) {
        toast.success(payload.vpaths.length === 1 ? '1 Datei hinzugefügt' : `${payload.vpaths.length} Daten hinzugefügt`)
      }
      addStaged(payload)
    } catch {
      /* ignore malformed payload */
    }
  }

  const onDragOver = (e: React.DragEvent): void => {
    if (usbMode) return
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault()
      setDropActive(true)
    }
  }

  const send = (): void => {
    if (!server || staged.length === 0) return
    setShareItems(staged.map((s) => ({ vpath: s.vpath, name: s.name, size: 0, isDirectory: false })))
  }

  const startBurn = (): void => {
    if (!server || staged.length === 0) return
    const items = staged.map((s) => ({ vpath: s.vpath, name: s.name }))
    setBurnSources({ local: [], remote: { server, items } })
  }

  const eject = async (): Promise<void> => {
    setEjecting(true)
    let res: { ok: boolean; error?: string } = { ok: false, error: 'Kein Laufwerk gefunden' }
    if (audioCdDrive) {
      res = await window.api.drives.ejectOptical(audioCdDrive.device)
    } else if (dataDrive?.isOptical) {
      res = await window.api.drives.ejectOptical(dataDrive.device)
    } else if (usbPath) {
      res = await window.api.drives.eject(usbPath)
    }
    setEjecting(false)
    if (res.ok) toast.success('Medium wurde ausgeworfen')
    else toast.error(`Auswerfen fehlgeschlagen: ${res.error ?? 'unbekannt'}`)
  }

  return (
    <div className="border-ink bg-bg-surface relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-container border-2">
      {/* Bühne: Remote-Pane + darüber liegendes Tray (clippt das geschlossene Tray) */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0">{children}</div>

        <section
          aria-hidden={!open}
          onDragOver={onDragOver}
          onDragLeave={() => setDropActive(false)}
          onDrop={onDrop}
          className={`bg-bg-surface border-ink absolute inset-x-0 bottom-0 top-[42%] overflow-hidden rounded-t-container border-2 border-b-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            open ? 'translate-y-0' : 'translate-y-full'
          } ${dropActive ? 'ring-ink/40 ring-2' : ''}`}
        >
          {isVideoDvd && dataDrive ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6">
              <CompactDisc className="size-16 text-ink-muted" strokeWidth={2} />
              <div className="text-xl font-bold uppercase text-ink">Video-DVD erkannt</div>
              <div className="text-meta text-ink-muted text-center max-w-md">
                Möchtest du diese Video-DVD in die Agora übertragen?
              </div>
              <Button size="lg" variant="outline" className="rounded-pill text-ink" onClick={() => setRipOpen(true)}>
                Zur Agora hinzufügen
              </Button>
            </div>
          ) : audioCdDrive ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6">
              <CompactDisc className="size-16 text-ink-muted" strokeWidth={2} />
              <div className="text-xl font-bold uppercase text-ink">Audio-CD erkannt</div>
              <div className="text-meta text-ink-muted text-center max-w-md">
                Möchtest du diese Audio-CD in die Agora übertragen?
              </div>
              <Button size="lg" variant="outline" className="rounded-pill text-ink" onClick={() => setRipOpen(true)}>
                Zur Agora hinzufügen
              </Button>
            </div>
          ) : usbPath ? (
            <div className="absolute inset-0">
              <FileBrowserPane key={usbPath} rootPath={usbPath} />
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6">
              {staged.length === 0 ? (
                burnDrive ? (
                  <div className="flex flex-col items-center gap-4 text-ink-muted">
                    <CompactDisc className="size-16" strokeWidth={2} />
                    <span className="text-meta text-center max-w-sm">
                      {burnDrive.description || 'DVD-Laufwerk'} — Dateien aus der Agora hierher ziehen, um sie auf die Disc zu brennen.
                    </span>
                  </div>
                ) : (
                  <MobileUploadPanel />
                )
              ) : (
                <div className="flex max-h-full w-full max-w-2xl flex-wrap content-start justify-center gap-2 overflow-auto">
                  {staged.map((s) => (
                    <span
                      key={s.vpath}
                      className="text-label border-ink text-ink inline-flex max-w-[16rem] items-center gap-1.5 rounded-pill border px-3 py-1.5"
                    >
                      <span className="truncate">{s.name}</span>
                      <button
                        type="button"
                        aria-label="Aus Auswahl entfernen"
                        onClick={() => setStaged((p) => p.filter((x) => x.vpath !== s.vpath))}
                        className="text-ink-muted hover:text-ink shrink-0"
                      >
                        <Xmark className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {staged.length > 0 && !burnDrive && (
                <button
                  type="button"
                  onClick={send}
                  className="text-body bg-ink text-ink-leaf inline-flex items-center gap-2 rounded-pill px-6 py-2.5 font-medium outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Send className="size-4" />
                  {staged.length} auf Smartphone senden
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Schwarze Bottom-Bar */}
      <div 
        className={`bg-ink text-ink-leaf flex h-16 shrink-0 items-center gap-3 px-4 ${dropActive && !usbMode ? 'ring-ink-leaf/40 ring-2' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
      >
        <div className="flex-1 flex justify-start items-center gap-3">
          {usbMode && (
            <>
              <IconPill
                onClick={eject}
                disabled={ejecting}
                title="USB-Stick auswerfen"
                aria-label="USB-Stick auswerfen"
                className="border-ink-leaf text-ink-leaf hover:bg-ink-leaf/10"
              >
                <Eject className="size-4" />
              </IconPill>
              <span className="text-label bg-ink-leaf text-ink inline-flex items-center rounded-pill px-5 py-2 font-medium uppercase tracking-wide">
                {audioCdDrive ? 'Audio-CD' : isVideoDvd ? (usbLabel ?? 'Video-DVD') : (usbLabel ?? 'USB Stick')}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-body bg-ink-leaf text-ink inline-flex items-center gap-2 rounded-pill px-6 py-2.5 font-medium outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {burnDrive ? <CompactDisc className="size-4" /> : open ? <NavArrowDown className="size-4" /> : <NavArrowUp className="size-4" />}
          {burnDrive ? 'DISC' : 'Datentausch'}
        </button>
        <div className="flex-1 flex justify-end items-center gap-3">
          {!usbMode && burnDrive && staged.length > 0 && (
            <button
              type="button"
              onClick={startBurn}
              className="text-body bg-white text-ink inline-flex items-center gap-2 rounded-pill px-6 py-2.5 font-bold outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <FireFlame className="size-5" />
              BRENNEN
            </button>
          )}
        </div>
      </div>

      {burnSources && burnDrive && (
        <BurnDialog device={burnDrive.device} sources={burnSources} onClose={(success) => {
          setBurnSources(null)
          if (success) {
            setStaged([])
          }
        }} />
      )}

      {shareItems && server && (
        <QrShareDialog
          server={server}
          items={shareItems}
          onClose={() => {
            setShareItems(null)
            setStaged([])
          }}
        />
      )}

      {ripOpen && isVideoDvd && dataDrive && server && (
        <RipDialog mountPath={dataDrive.mountpoints[0]?.path ?? ''} label={dataDrive.mountpoints[0]?.label ?? 'DVD'} server={server} onClose={() => setRipOpen(false)} />
      )}

      {ripOpen && audioCdDrive && server && (
        <CdRipDialog device={audioCdDrive.device} server={server} onClose={() => setRipOpen(false)} />
      )}
    </div>
  )
}
