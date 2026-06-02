import { useEffect, useState } from 'react'

const THUMBABLE = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|svg|heic|heif|mp4|mkv|webm|mov|m4v|avi|mp3|flac|ogg|opus|m4a|wav|aiff?|pdf)$/i

interface Props {
  server: string
  vpath: string
  name: string
  className?: string
  fallback: React.ReactNode
}

const cache = new Map<string, string | null>()

export function RemoteThumb({ server, vpath, name, className, fallback }: Props): React.JSX.Element {
  const key = `${server}|${vpath}`
  const [src, setSrc] = useState<string | null | undefined>(() => cache.get(key))

  useEffect(() => {
    if (cache.has(key)) {
      setSrc(cache.get(key))
      return
    }
    if (!THUMBABLE.test(name)) {
      cache.set(key, null)
      setSrc(null)
      return
    }
    let cancelled = false
    void window.api.cpp.thumb(server, vpath).then((dataUrl) => {
      if (cancelled) return
      cache.set(key, dataUrl)
      setSrc(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [key, server, vpath, name])

  if (src) {
    return <img src={src} alt={name} className={className} draggable={false} />
  }
  return <>{fallback}</>
}
