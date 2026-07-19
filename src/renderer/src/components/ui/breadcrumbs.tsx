import { Fragment } from 'react'
import { cn } from '@/lib/utils'

interface Segment {
  label: string
  onClick?: () => void
}

interface Props {
  segments: Segment[]
  className?: string
}

/**
 * Breadcrumb als verbundene Pill-Bubbles im Agora-Look.
 * Metaball-Verbindung angenähert: zwischen zwei Segmenten sitzt eine kurze
 * „Brücke" (border-y, z über den Pills) — sie überdeckt die vertikalen
 * Pill-Ränder in einem schmalen Halsband → optischer Pinch statt Chevron.
 * Aktives (letztes) Segment = schwarz gefüllt, Serif (text-breadcrumb-leaf).
 */
export function Breadcrumbs({ segments, className }: Props): React.JSX.Element {
  if (segments.length === 0) return <div className={className} />

  return (
    <nav
      aria-label="breadcrumb"
      className={cn('inline-flex min-w-0 max-w-full items-center', className)}
    >
      {segments.map((seg, i) => {
        const active = i === segments.length - 1
        return (
          <Fragment key={`${i}-${seg.label}`}>
            {i > 0 && <Bridge dark={active} />}
            <button
              type="button"
              onClick={seg.onClick}
              disabled={!seg.onClick || active}
              className={cn(
                'relative z-0 inline-flex h-[34px] min-w-0 shrink items-center rounded-pill border border-ink px-4 transition-colors disabled:cursor-default',
                active
                  ? 'text-breadcrumb-leaf bg-ink text-ink-leaf'
                  : 'text-breadcrumb-segment bg-bg-surface text-ink hover:bg-ink/5'
              )}
            >
              <span className="truncate">{seg.label}</span>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}

/** Verbindungshals zwischen zwei Segment-Pills. */
function Bridge({ dark }: { dark: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 -mx-[7px] h-[15px] w-[14px] shrink-0 border-y border-ink',
        dark ? 'bg-ink' : 'bg-bg-surface'
      )}
    />
  )
}
