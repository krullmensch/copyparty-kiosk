import { File as FileIcon, Music } from 'lucide-react'

const AUDIO_EXT = /\.(mp3|flac|aac|wav|alac|m4a|ogg|opus|aif|aiff)$/i

interface Props {
  name: string
  className?: string
  strokeWidth?: number
}

export function FileTypeIcon({ name, className, strokeWidth }: Props): React.JSX.Element {
  if (AUDIO_EXT.test(name)) {
    return <Music className={className} strokeWidth={strokeWidth} />
  }
  return <FileIcon className={className} strokeWidth={strokeWidth} />
}
