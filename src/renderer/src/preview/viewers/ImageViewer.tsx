import { useEffect, useMemo, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { needsConversion } from '../../../../shared/filetypes'
import type { FileMetadata, PreviewSource } from '../../../../shared/types'
import { Button } from '@/components/ui/button'
import { streamUrl, convertedUrl } from '../streamUrl'

const EXIF_FIELDS: { label: string; keys: string[] }[] = [
  { label: 'Kamera', keys: ['Make', 'Model'] },
  { label: 'Objektiv', keys: ['LensModel', 'Lens'] },
  { label: 'Belichtung', keys: ['ExposureTime', 'ShutterSpeed'] },
  { label: 'Blende', keys: ['FNumber', 'Aperture'] },
  { label: 'ISO', keys: ['ISO'] },
  { label: 'Brennweite', keys: ['FocalLength'] },
  { label: 'Aufnahme', keys: ['DateTimeOriginal', 'CreateDate'] },
  { label: 'GPS', keys: ['GPSPosition', 'GPSLatitude'] }
]

export function ImageViewer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [meta, setMeta] = useState<FileMetadata | null>(null)

  useEffect(() => {
    let alive = true
    setSrc(null)
    setError(null)
    setZoom(1)

    const resolve = async (): Promise<void> => {
      if (!needsConversion(entry.name)) {
        if (alive) setSrc(streamUrl(source))
        return
      }
      // TIFF/RAW: konvertieren (nur lokal); Browser kann diese Formate nicht nativ.
      const res = await window.api.preview.convert(source)
      if (!alive) return
      if (res.ok) setSrc(convertedUrl(res.cacheKey))
      else setError('Format kann nicht angezeigt werden')
    }
    void resolve()
    return () => {
      alive = false
    }
  }, [entry.name, source])

  useEffect(() => {
    let alive = true
    window.api.preview.metadata(source).then((m) => {
      if (alive) setMeta(m)
    })
    return () => {
      alive = false
    }
  }, [source])

  const exif = useMemo(() => {
    if (!meta) return []
    return EXIF_FIELDS.map(({ label, keys }) => {
      for (const k of keys) {
        const v = meta.raw[k]
        if (v != null && String(v).length > 0) return { label, value: String(v) }
      }
      return null
    }).filter((x): x is { label: string; value: string } => x !== null)
  }, [meta])

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {error ? (
          <div className="text-ink-muted">{error}</div>
        ) : src ? (
          <img
            src={src}
            alt={entry.name}
            onError={() => setError('Bild konnte nicht geladen werden')}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            className="max-h-full max-w-full object-contain transition-transform"
          />
        ) : (
          <div className="text-ink-muted">Lädt…</div>
        )}
      </div>

      <div className="border-border flex items-center gap-2 border-t px-4 py-2">
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.1, z - 0.25))}>
          <Minus />
        </Button>
        <span className="text-meta text-ink-muted w-12 text-center">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(8, z + 0.25))}>
          <Plus />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
          <Maximize2 /> Anpassen
        </Button>
        {exif.length > 0 && (
          <div className="text-meta text-ink-faint ml-auto flex flex-wrap gap-x-4 gap-y-0.5">
            {exif.map((e) => (
              <span key={e.label}>
                <span className="text-ink-muted">{e.label}:</span> {e.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
