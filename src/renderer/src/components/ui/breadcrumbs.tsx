import { useLayoutEffect, useRef, useState } from 'react'
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

/* Metaball-Geometrie — an einer Stelle justierbar. */
const H = 36 // Pill-Höhe
const BW = 1.5 // Outline-Stärke (schwarze Silhouette hinter der Füllung)
const SEP = 8 // Abstand zwischen zwei Pills (margin-left der Buttons)
const CW = 16 // Connector-Breite (überlappt SEP → greift in beide Pills)
const CH = 10 // Connector-Höhe (dünn → Goo pincht zum konkaven Hals)

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
 * Token-getrieben (--ink/--bg-surface) ⇒ Dark-Mode automatisch.
 */
export function Breadcrumbs({ segments, className }: Props): React.JSX.Element {
  const navRef = useRef<HTMLElement>(null)
  const [rects, setRects] = useState<Rect[]>([])
  const lastIdx = segments.length - 1

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
  }, [segments])

  if (segments.length === 0) return <div className={className} />

  const ready = rects.length === segments.length
  // Mittelpunkt der Lücke zwischen Pill i und i+1 (Halsposition).
  const junctionX = (i: number): number =>
    (rects[i].left + rects[i].width + rects[i + 1].left) / 2

  return (
    <nav
      ref={navRef}
      aria-label="breadcrumb"
      className={cn('relative inline-flex max-w-full items-center', className)}
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
                    <span className="bg-ink absolute right-0 top-0 h-full" style={{ width: CW / 2 }} />
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
        {segments.map((seg, i) => {
          const active = i === lastIdx
          return (
            <button
              key={`txt-${i}`}
              data-crumb-btn
              type="button"
              onClick={seg.onClick}
              disabled={!seg.onClick || active}
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
  )
}
