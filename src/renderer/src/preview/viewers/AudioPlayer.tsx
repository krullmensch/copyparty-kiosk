import { useState } from 'react'
import type { PreviewSource } from '../../../../shared/types'
import { streamUrl } from '../streamUrl'

/**
 * Native <audio> playback over the loopback media-server (HTTP range/seek),
 * the same path VideoPlayer uses. Chromium decodes FLAC/MP3/etc. natively, so
 * no library and no full-file decode -- the earlier wavesurfer approach
 * (readBytes -> Blob -> decodeAudioData) hung on FLAC and never became ready.
 */
export function AudioPlayer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="bg-background flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="border-border text-foreground flex flex-col items-center gap-1 rounded border p-6 text-center">
          <span className="font-medium">{entry.name}</span>
          <span className="text-ink-muted">Audio kann nicht abgespielt werden (Codec?)</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background flex h-full flex-col items-center justify-center gap-6 p-8">
      <span className="text-h2 max-w-3xl truncate text-center" title={entry.name}>
        {entry.name}
      </span>
      <audio
        key={streamUrl(source)}
        src={streamUrl(source)}
        controls
        autoPlay
        onError={() => setError(true)}
        controlsList="nodownload noremoteplayback"
        className="w-full max-w-2xl"
      />
    </div>
  )
}
