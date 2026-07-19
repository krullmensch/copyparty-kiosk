import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Pill-Chip im Agora-Look: dünne ink-Outline, aktiv = schwarz gefüllt.
 * Genutzt für Sortier-/Filter-Chips (Name/Größe/Datum/Format).
 */
interface ChipProps extends React.ComponentProps<'button'> {
  active?: boolean
}

export function Chip({ active = false, className, ...props }: ChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-active={active}
      className={cn(
        'text-label inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border border-ink px-4 font-medium outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40',
        "[&_svg]:size-3.5 [&_svg:not([class*='size-'])]:size-3.5",
        active
          ? 'bg-ink text-ink-leaf'
          : 'bg-transparent text-ink hover:bg-ink/5',
        className
      )}
      {...props}
    />
  )
}

/**
 * Runder Icon-Button (Refresh/Zurück) im Agora-Look: ink-Outline-Kreis.
 */
export function IconPill({
  className,
  ...props
}: React.ComponentProps<'button'>): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-pill border border-ink bg-transparent text-ink outline-none transition-colors',
        'hover:bg-ink/5 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40',
        "[&_svg]:size-4",
        className
      )}
      {...props}
    />
  )
}
