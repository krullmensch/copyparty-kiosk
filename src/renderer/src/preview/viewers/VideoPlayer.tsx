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

  useEffect(() => {
    setError(false)
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
        </div>
      ) : (
        <video
          ref={videoRef}
          src={streamUrl(source)}
          controls
          // Kiosk: no keyboard to escape native OS fullscreen. Drop the
          // fullscreen/PiP/download buttons so the player stays inline in the
          // FullView; the user always leaves via the ✕ button.
          controlsList="nofullscreen nodownload noremoteplayback"
          disablePictureInPicture
          onDoubleClick={(e) => e.preventDefault()}
          onError={() => setError(true)}
          className="max-h-full max-w-full"
        />
      )}
    </div>
  )
}
