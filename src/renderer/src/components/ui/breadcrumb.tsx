import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Segment {
  label: string
  onClick?: () => void
}

interface BreadcrumbProps {
  segments: Segment[]
  className?: string
}

export function Breadcrumb({ segments, className }: BreadcrumbProps): React.JSX.Element {
  if (segments.length === 0) return <div className={className} />
  const head = segments.slice(0, -1)
  const leaf = segments[segments.length - 1]

  return (
    <nav
      aria-label="breadcrumb"
      className={cn(
        'flex items-center gap-2',
        'h-[var(--breadcrumb-capsule-height)]',
        className
      )}
    >
      {head.map((seg, i) => (
        <React.Fragment key={`${seg.label}-${i}`}>
          <button
            type="button"
            onClick={seg.onClick}
            className={cn(
              'text-breadcrumb-segment text-ink hover:text-accent transition-colors',
              !seg.onClick && 'cursor-default'
            )}
            disabled={!seg.onClick}
          >
            {seg.label}
          </button>
          <ChevronRight className="text-ink size-5 shrink-0" strokeWidth={1.5} />
        </React.Fragment>
      ))}

      <span
        className={cn(
          'bg-accent text-ink-leaf rounded-pill',
          'flex h-full items-center px-5',
          'text-breadcrumb-leaf'
        )}
        onClick={leaf.onClick}
        role={leaf.onClick ? 'button' : undefined}
      >
        {leaf.label}
      </span>
    </nav>
  )
}
