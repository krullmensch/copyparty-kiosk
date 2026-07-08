import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js'
import { Pause, Play } from 'lucide-react'
import type { PreviewSource } from '../../../../shared/types'
import { Button } from '@/components/ui/button'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioPlayer({
  entry,
  source
}: {
  entry: { name: string; size: number }
  source: PreviewSource
}): React.JSX.Element {
  const waveRef = useRef<HTMLDivElement>(null)
  const spectroRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)

  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const container = waveRef.current
    const spectroContainer = spectroRef.current
    if (!container || !spectroContainer) return

    setError(false)
    setReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)

    const dark = document.documentElement.classList.contains('dark')
    const waveColor = dark ? '#525252' : '#a3a3a3'
    const progressColor = dark ? '#e5e5e5' : '#404040'
    const cursorColor = dark ? '#fafafa' : '#171717'

    let ws: WaveSurfer | null = null
    let objectUrl: string | null = null
    let cancelled = false

    // wavesurfer muss die vollständige Datei dekodieren (Waveform + Spektrum).
    // Der Renderer kann kiosk-stream:// NICHT selbst fetchen (custom-scheme
    // cross-origin → opaque). Bytes daher über den Main holen und als same-origin
    // Blob-URL an wavesurfer geben — das deckt Decode UND Playback ab.
    const load = async (): Promise<void> => {
      const bytes = await window.api.preview.readBytes(source)
      if (cancelled) return
      if (!bytes) {
        setError(true)
        return
      }
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)]))
      try {
        ws = WaveSurfer.create({
          container,
          url: objectUrl,
          waveColor,
          progressColor,
          cursorColor,
          height: 96,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          plugins: [
            Spectrogram.create({
              container: spectroContainer,
              labels: false,
              height: 128,
              scale: 'mel',
              fftSamples: 512,
              colorMap: 'roseus'
            })
          ]
        })
      } catch {
        setError(true)
        return
      }
      wsRef.current = ws
      ws.on('ready', (d) => {
        setDuration(d)
        setReady(true)
      })
      ws.on('timeupdate', (t) => setCurrentTime(t))
      ws.on('play', () => setIsPlaying(true))
      ws.on('pause', () => setIsPlaying(false))
      ws.on('finish', () => setIsPlaying(false))
      ws.on('error', () => setError(true))
    }
    void load()

    return () => {
      cancelled = true
      try {
        ws?.destroy()
      } catch {
        // ignore teardown errors
      }
      wsRef.current = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source])

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
    <div className="bg-background flex h-full flex-col items-center justify-center gap-4 p-8">
      <span className="text-h2 max-w-3xl truncate text-center" title={entry.name}>
        {entry.name}
      </span>

      <div ref={waveRef} className="w-full max-w-3xl" />
      <div ref={spectroRef} className="w-full max-w-3xl" />

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          disabled={!ready}
          onClick={() => wsRef.current?.playPause()}
          aria-label={isPlaying ? 'Pause' : 'Wiedergabe'}
        >
          {isPlaying ? <Pause /> : <Play />}
        </Button>
        <span className="text-meta text-ink-muted tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
