import { useEffect, useRef, useState } from 'react'
import type { PreviewSource } from '../../../../shared/types'
import { formatSize } from '../../lib/format'
import { streamUrl } from '../streamUrl'

export function VideoPlayer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState(false)
  const [diag, setDiag] = useState('')

  useEffect(() => {
    setError(false)
    setDiag('')
  }, [entry.name, source])

  useEffect(() => {
    return () => {
      videoRef.current?.pause()
    }
  }, [])

  return (
    <div className="flex h-full items-center justify-center bg-black">
      {error ? (
        <div className="bg-background border-border text-foreground flex flex-col items-center gap-1 rounded border p-6 text-center">
          <span className="font-medium">{entry.name}</span>
          <span className="text-ink-muted">
            Codec nicht unterstützt — dieses Format kann in der Vorschau nicht abgespielt werden.
          </span>
          <span className="text-meta text-ink-faint">{formatSize(entry.size)}</span>
          {diag && <span className="text-meta text-ink-faint">{diag}</span>}
        </div>
      ) : (
        <video
          ref={videoRef}
          src={streamUrl(source)}
          controls
          onError={(e) => {
            const err = e.currentTarget.error
            setDiag(err ? `MediaError code=${err.code} ${err.message ?? ''}` : 'no MediaError')
            setError(true)
          }}
          className="max-h-full max-w-full"
        />
      )}
    </div>
  )
}
