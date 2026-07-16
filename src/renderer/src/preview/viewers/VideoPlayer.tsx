import '@videojs/react/video/skin.css'
import { useEffect, useState } from 'react'
import { createPlayer } from '@videojs/react'
import { Video, VideoSkin, videoFeatures } from '@videojs/react/video'
import type { PreviewSource } from '../../../../shared/types'
import { formatSize } from '../../lib/format'
import { streamUrl } from '../streamUrl'

// One player definition for the whole app; each mount gets its own Provider
// store instance, so this is safe to hoist to module scope.
const Player = createPlayer({ features: videoFeatures })

export function VideoPlayer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const [error, setError] = useState(false)

  useEffect(() => {
    setError(false)
  }, [entry.name, source])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <div className="bg-background border-border text-foreground flex flex-col items-center gap-1 rounded border p-6 text-center">
          <span className="font-medium">{entry.name}</span>
          <span className="text-ink-muted">
            Codec nicht unterstützt — dieses Format kann in der Vorschau nicht abgespielt werden.
          </span>
          <span className="text-meta text-ink-faint">{formatSize(entry.size)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full items-center justify-center bg-black">
      {/* Kiosk: no keyboard to escape native OS fullscreen, and PiP would float
          outside the kiosk window entirely. VideoSkin has no prop to omit
          individual buttons, so hide them by their stable skin classes. */}
      {/* The skin's base ".media-default-skin .media-button" rule (specificity
          0,2,0) sets display:flex and beats a plain ".media-button--pip"
          selector (0,1,0) regardless of source order, so match its
          specificity and use !important to stay correct across skin updates. */}
      <style>{`
        .media-default-skin .media-button--pip,
        .media-default-skin .media-button--fullscreen { display: none !important; }
        .media-default-skin, .media-default-skin video { border-radius: 0 !important; }
      `}</style>
      <Player.Provider>
        <VideoSkin>
          <Video
            src={streamUrl(source)}
            playsInline
            onError={() => setError(true)}
            className="max-h-full max-w-full"
          />
        </VideoSkin>
      </Player.Provider>
    </div>
  )
}
