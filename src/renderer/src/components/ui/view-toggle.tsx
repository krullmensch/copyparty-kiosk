import { List, ViewGrid } from 'iconoir-react'
import { IconPill } from '@/components/ui/chip'

export type ViewMode = 'list' | 'grid'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ mode, onChange }: Props): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <IconPill
        onClick={() => onChange('list')}
        title="Listenansicht"
        aria-label="Listenansicht"
        className={mode === 'list' ? 'bg-ink text-ink-leaf' : ''}
      >
        <List />
      </IconPill>
      <IconPill
        onClick={() => onChange('grid')}
        title="Gitteransicht"
        aria-label="Gitteransicht"
        className={mode === 'grid' ? 'bg-ink text-ink-leaf' : ''}
      >
        <ViewGrid />
      </IconPill>
    </div>
  )
}
