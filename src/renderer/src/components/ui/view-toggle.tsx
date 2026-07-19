import { List, ViewGrid } from 'iconoir-react'
import { Button } from '@/components/ui/button'

export type ViewMode = 'list' | 'grid'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function ViewToggle({ mode, onChange }: Props): React.JSX.Element {
  return (
    <div className="bg-bg-page-tint rounded-input inline-flex p-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange('list')}
        className={mode === 'list' ? 'bg-bg-surface' : 'opacity-60'}
        title="list view"
      >
        <List className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange('grid')}
        className={mode === 'grid' ? 'bg-bg-surface' : 'opacity-60'}
        title="grid view"
      >
        <ViewGrid className="size-4" />
      </Button>
    </div>
  )
}
