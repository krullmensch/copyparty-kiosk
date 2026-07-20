import { useEffect, useState } from 'react'
import { AppWindow } from 'lucide-react'
import type { PreviewSource } from '../../../../shared/types'

/**
 * Programm-Vorschau: nur Icon + Name, nie ausführbar/öffenbar.
 * Wird in QuickLook und (falls FullView doch aufgerufen wird) wiederverwendet.
 */
export function ProgramPreview({
  source,
  name
}: {
  source: PreviewSource
  name: string
}): React.JSX.Element {
  const [icon, setIcon] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.preview.icon(source).then((d) => {
      if (alive) setIcon(d)
    })
    return () => {
      alive = false
    }
  }, [source])

  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      {icon ? (
        <img src={icon} alt="" className="size-24 object-contain" />
      ) : (
        <AppWindow className="text-ink-muted size-20" strokeWidth={2} />
      )}
      <div className="text-h2 break-all">{name}</div>
      <div className="text-meta text-ink-faint">Programm — nicht ausführbar</div>
    </div>
  )
}
