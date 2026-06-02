import { useEffect, useState } from 'react'

const THUMBABLE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|mp4|mkv|webm|mov|m4v|avi|mp3|flac|ogg|opus|m4a|wav|aiff?|pdf)$/i

interface Props {
  path: string
  name: string
  className?: string
  fallback: React.ReactNode
}

const cache = new Map<string, string | null>()

export function LocalThumb({ path, name, className, fallback }: Props): React.JSX.Element {
  const [src, setSrc] = useState<string | null | undefined>(() => cache.get(path))

  useEffect(() => {
    if (cache.has(path)) {
      setSrc(cache.get(path))
      return
    }
    if (!THUMBABLE.test(name)) {
      cache.set(path, null)
      setSrc(null)
      return
    }
    let cancelled = false
    void window.api.fs.thumb(path).then((dataUrl) => {
      if (cancelled) return
      cache.set(path, dataUrl)
      setSrc(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [path, name])

  if (src) {
    return <img src={src} alt={name} className={className} draggable={false} />
  }
  return <>{fallback}</>
}
