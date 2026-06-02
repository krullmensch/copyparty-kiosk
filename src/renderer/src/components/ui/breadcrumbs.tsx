import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'

interface Segment {
  label: string
  onClick?: () => void
}

interface Props {
  segments: Segment[]
  className?: string
}

const LEAF_POINT_PX = 10

export function Breadcrumbs({ segments, className }: Props): React.JSX.Element {
  if (segments.length === 0) return <div className={className} />
  const head = segments.slice(0, -1)
  const leaf = segments[segments.length - 1]
  const onlyLeaf = head.length === 0

  return (
    <nav
      aria-label="breadcrumb"
      className={`bg-bg-surface border-border relative inline-flex h-[30px] min-w-0 max-w-full items-stretch overflow-hidden rounded-pill border text-[14px] leading-[16px] ${className ?? ''}`}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      <div
        className={`flex min-w-0 items-center gap-2 pl-[18px] pr-2 ${
          onlyLeaf ? 'hidden' : ''
        }`}
      >
        {head.map((seg, i) => (
          <Fragment key={`${i}-${seg.label}`}>
            <button
              type="button"
              onClick={seg.onClick}
              disabled={!seg.onClick}
              className="text-ink hover:text-accent truncate font-normal transition-colors disabled:cursor-default"
            >
              {seg.label}
            </button>
            <ChevronRight
              className="text-ink size-3 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
          </Fragment>
        ))}
      </div>
      <span
        role={leaf.onClick ? 'button' : undefined}
        onClick={leaf.onClick}
        className={`bg-accent text-ink-leaf flex items-center font-medium ${
          onlyLeaf ? 'px-[18px]' : 'pr-4'
        }`}
        style={
          onlyLeaf
            ? undefined
            : {
                paddingLeft: `${LEAF_POINT_PX + 12}px`,
                clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, ${LEAF_POINT_PX}px 50%)`
              }
        }
      >
        {leaf.label}
      </span>
    </nav>
  )
}
