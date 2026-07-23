import { useState, useMemo } from 'react'
import { MusicDoubleNote } from 'iconoir-react'
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

  const bgColor = useMemo(() => {
    const colors = [
      'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 
      'bg-teal-500', 'bg-cyan-500', 'bg-blue-500', 'bg-indigo-500', 
      'bg-violet-500', 'bg-fuchsia-500'
    ]
    let hash = 0
    for (let i = 0; i < entry.name.length; i++) {
      hash = entry.name.charCodeAt(i) + ((hash << 5) - hash)
    }
    const index = Math.abs(hash) % colors.length
    return colors[index]
  }, [entry.name])

  return (
    <div className="bg-background flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className={`flex items-center justify-center size-64 sm:size-80 rounded-2xl shadow-xl shrink-0 text-white ${bgColor}`}>
        <MusicDoubleNote className="size-24 sm:size-32 opacity-80" />
      </div>
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
