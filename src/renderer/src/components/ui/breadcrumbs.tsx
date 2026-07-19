import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Segment {
  label: string
  onClick?: () => void
}

interface Props {
  segments: Segment[]
  className?: string
}

interface Rect {
  left: number
  width: number
}

interface VisibleSegment extends Segment {
  isEllipsis?: boolean
}

/* Metaball-Geometrie — an einer Stelle justierbar. */
const H = 36 // Pill-Höhe
const BW = 1.5 // Outline-Stärke (schwarze Silhouette hinter der Füllung)
const SEP = 8 // Abstand zwischen zwei Pills (margin-left der Buttons)
const CW = 16 // Connector-Breite (überlappt SEP → greift in beide Pills)
const CH = 10 // Connector-Höhe (dünn → Goo pincht zum konkaven Hals)
const PAD_X = 16 // px-4 je Seite eines Buttons
const ELLIPSIS_LABEL = '…'

// Fonts/Tracking exakt wie .text-breadcrumb-segment / .text-breadcrumb-leaf (main.css).
const SEGMENT_FONT = '400 22px Inter, ui-sans-serif, system-ui, sans-serif'
const LEAF_FONT = '400 25px "Averia Serif Libre", ui-serif, Georgia, serif'
const SEGMENT_TRACKING_PX = 0 // --tracking-body: 0em
const LEAF_TRACKING_PX = -0.03 * 25 // --tracking-serif: -0.03em bei 25px

let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  return measureCtx!
}

function textWidth(text: string, font: string, letterSpacingPx: number): number {
  const ctx = getMeasureCtx()
  ctx.font = font
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if (typeof c.letterSpacing === 'string') {
    c.letterSpacing = `${letterSpacingPx}px`
    return ctx.measureText(text).width
  }
  // Fallback für Canvas ohne letterSpacing-Support: manuell nachrechnen.
  return ctx.measureText(text).width + letterSpacingPx * Math.max(text.length - 1, 0)
}

function pillWidth(label: string, active: boolean): number {
  const w = active
    ? textWidth(label, LEAF_FONT, LEAF_TRACKING_PX)
    : textWidth(label, SEGMENT_FONT, SEGMENT_TRACKING_PX)
  return Math.ceil(w) + PAD_X * 2
}

/**
 * Kürzt Segmente von LINKS (älteste/oberste Ebenen zuerst) auf eine einzelne
 * "…"-Pille, sobald sie nicht in `availableWidth` passen. Die aktuelle Position
 * (letztes Segment) bleibt immer sichtbar. Breiten kommen aus echter
 * Canvas-Textmessung (Segment-/Leaf-Font inkl. Letter-Spacing) — ein Durchgang,
 * kein iteratives Nachmessen/Flackern.
 */
function truncateSegments(segments: Segment[], availableWidth: number | null): VisibleSegment[] {
  if (segments.length <= 1 || availableWidth == null) return segments

  const lastIdx = segments.length - 1
  const widths = segments.map((s, i) => pillWidth(s.label, i === lastIdx))
  const naturalTotal = widths.reduce((a, b) => a + b, 0) + SEP * lastIdx
  if (naturalTotal <= availableWidth) return segments

  const ellipsisWidth = pillWidth(ELLIPSIS_LABEL, false)
  let sum = widths[lastIdx]
  let firstKept = lastIdx
  for (let i = lastIdx - 1; i >= 0; i--) {
    const candidateSum = sum + SEP + widths[i]
    const needsEllipsisAfter = i > 0
    const total = needsEllipsisAfter ? candidateSum + SEP + ellipsisWidth : candidateSum
    if (total > availableWidth) break
    sum = candidateSum
    firstKept = i
  }

  if (firstKept === 0) return segments // Randfall: passt doch komplett

  const hiddenTail = segments[firstKept - 1] // letztes verdecktes (= nächstgelegenes) Segment
  return [
    { label: ELLIPSIS_LABEL, onClick: hiddenTail.onClick, isEllipsis: true },
    ...segments.slice(firstKept)
  ]
}

/**
 * Breadcrumb als gooey/metaball-verbundene Pills (Agora-Look, Mockup-treu).
 *
 * Robust gegen Font-Metriken: die Text-Buttons sind die einzige Größenquelle;
 * ihre realen Boxen werden per `useLayoutEffect` gemessen. Die Pill-Hintergründe
 * (ink-Silhouette + Füllung) werden aus diesen Messwerten absolut positioniert —
 * keine parallelen Ghost-Spans, die bei Serif/Sans-Divergenz überlaufen könnten.
 *
 *  1. ink   — schwarze Pills + dünne Connectors, per SVG-Goo-Filter zu einer
 *             durchgehenden Silhouette verschmolzen (= die Outline).
 *  2. fill  — dieselben Pills in bg-surface, um BW kleiner → nur Outline + Hälse
 *             bleiben. Aktives (letztes) Segment ink-gefüllt; der Hals davor am
 *             Pinch gesplittet (links surface, rechts ink) → sauberer Übergang.
 *  3. text  — die einzige interaktive Ebene (Buttons), unfiltert obenauf.
 *
 * Truncation: passt die volle Breadcrumb nicht in die verfügbare Breite (per
 * ResizeObserver auf dem Wrapper gemessen — die Spaltenbreite des Grids, NICHT
 * der eigene Content), werden linke Segmente zu einer "…"-Pille kollabiert
 * (siehe `truncateSegments`). Damit bleibt z. B. eine zentrierte Suchleiste
 * daneben an fester Position, egal wie tief der aktuelle Pfad ist.
 *
 * Token-getrieben (--ink/--bg-surface) ⇒ Dark-Mode automatisch.
 */
export function Breadcrumbs({ segments, className }: Props): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  const [rects, setRects] = useState<Rect[]>([])

  // Verfügbare Breite = Wrapper-Spalte (Grid-Column), nicht der eigene Content.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = (): void => setAvailableWidth(wrap.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const visible = useMemo(
    () => truncateSegments(segments, availableWidth),
    [segments, availableWidth]
  )
  const lastIdx = visible.length - 1

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = (): void => {
      const navBox = nav.getBoundingClientRect()
      const btns = Array.from(nav.querySelectorAll<HTMLElement>('[data-crumb-btn]'))
      setRects(
        btns.map((b) => {
          const r = b.getBoundingClientRect()
          return { left: r.left - navBox.left, width: r.width }
        })
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    let cancelled = false
    // Nach Font-Load erneut messen (Button-Breiten ändern sich beim Swap).
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [visible])

  if (segments.length === 0) return <div ref={wrapRef} className={className} />

  const ready = rects.length === visible.length
  // Mittelpunkt der Lücke zwischen Pill i und i+1 (Halsposition).
  const junctionX = (i: number): number =>
    (rects[i].left + rects[i].width + rects[i + 1].left) / 2

  return (
    <div ref={wrapRef} className={cn('min-w-0', className)}>
      <nav
        ref={navRef}
        aria-label="breadcrumb"
        className="relative inline-flex max-w-full items-center"
      >
        <svg width="0" height="0" aria-hidden className="absolute">
          <defs>
            <filter id="crumb-goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3.4" result="blur" />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -12"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
        </svg>

        {ready && (
          <>
            {/* Layer 1: ink-Silhouette (Outline) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ filter: 'url(#crumb-goo)' }}
            >
              {rects.map((r, i) => (
                <span
                  key={`ink-pill-${i}`}
                  className="bg-ink absolute"
                  style={{ left: r.left, top: 0, width: r.width, height: H, borderRadius: 999 }}
                />
              ))}
              {rects.slice(1).map((_, i) => {
                const cx = junctionX(i)
                return (
                  <span
                    key={`ink-conn-${i}`}
                    className="bg-ink absolute"
                    style={{ left: cx - CW / 2, top: (H - CH) / 2, width: CW, height: CH }}
                  />
                )
              })}
            </div>

            {/* Layer 2: Füllung */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ filter: 'url(#crumb-goo)' }}
            >
              {rects.map((r, i) => {
                const active = i === lastIdx
                return (
                  <span
                    key={`fill-pill-${i}`}
                    className={cn('absolute', active ? 'bg-ink' : 'bg-bg-surface')}
                    style={{
                      left: r.left + BW,
                      top: BW,
                      width: r.width - BW * 2,
                      height: H - BW * 2,
                      borderRadius: 999
                    }}
                  />
                )
              })}
              {rects.slice(1).map((_, i) => {
                const cx = junctionX(i)
                const h = CH - BW * 2
                const top = (H - h) / 2
                // Hals in die aktive Pill am Pinch splitten → kein Keil/Nub.
                const activeJoin = i + 1 === lastIdx
                if (activeJoin) {
                  return (
                    <span
                      key={`fill-conn-${i}`}
                      className="absolute"
                      style={{ left: cx - CW / 2, top, width: CW, height: h }}
                    >
                      <span
                        className="bg-bg-surface absolute left-0 top-0 h-full"
                        style={{ width: CW / 2 }}
                      />
                      <span
                        className="bg-ink absolute right-0 top-0 h-full"
                        style={{ width: CW / 2 }}
                      />
                    </span>
                  )
                }
                return (
                  <span
                    key={`fill-conn-${i}`}
                    className="bg-bg-surface absolute"
                    style={{ left: cx - CW / 2, top, width: CW, height: h }}
                  />
                )
              })}
            </div>
          </>
        )}

        {/* Layer 3: interaktiver Text (Größenquelle) */}
        <div className="relative flex items-center" style={{ height: H }}>
          {visible.map((seg, i) => {
            const active = i === lastIdx
            return (
              <button
                key={`txt-${i}-${seg.isEllipsis ? 'ellipsis' : seg.label}`}
                data-crumb-btn
                type="button"
                onClick={seg.onClick}
                disabled={!seg.onClick || active}
                title={seg.isEllipsis ? 'Verdeckte Ebenen anzeigen' : undefined}
                style={{ marginLeft: i === 0 ? 0 : SEP }}
                className={cn(
                  'relative z-10 flex h-full shrink-0 items-center whitespace-nowrap px-4 outline-none disabled:cursor-default',
                  active
                    ? 'text-breadcrumb-leaf text-ink-leaf'
                    : 'text-breadcrumb-segment text-ink hover:underline'
                )}
              >
                {seg.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
