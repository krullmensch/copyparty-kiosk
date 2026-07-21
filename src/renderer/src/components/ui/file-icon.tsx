import { File as FileIcon, Music } from 'lucide-react'

const AUDIO_EXT = /\.(mp3|flac|aac|wav|alac|m4a|ogg|opus|aif|aiff)$/i

const AUDIO_COLORS = [
  '#ef476f', // red/pink
  '#f78c6b', // orange
  '#ffd166', // yellow
  '#06d6a0', // green
  '#118ab2', // blue
  '#073b4c', // dark blue
  '#a05195', // purple
  '#d45087', // magenta
  '#f95d6a', // coral
  '#ff7c43'  // tangerine
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return Math.abs(h)
}

interface Props {
  name: string
  className?: string
  strokeWidth?: number
}

export function FileTypeIcon({ name, className, strokeWidth }: Props): React.JSX.Element {
  if (AUDIO_EXT.test(name)) {
    const color = AUDIO_COLORS[hashString(name) % AUDIO_COLORS.length]
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: color }}>
        <Music className={className} style={{ color: '#ffffff' }} strokeWidth={strokeWidth} />
      </div>
    )
  }
  return <FileIcon className={className} strokeWidth={strokeWidth} />
}
