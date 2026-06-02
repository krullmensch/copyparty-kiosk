type Props = {
  name: string
  isDirectory?: boolean
  className?: string
}

export function Filename({ name, isDirectory, className }: Props) {
  const dot = name.lastIndexOf('.')
  const hasExt = !isDirectory && dot > 0 && dot < name.length - 1
  const base = hasExt ? name.slice(0, dot) : name
  const ext = hasExt ? name.slice(dot) : ''
  return (
    <span className={`flex min-w-0 ${className ?? ''}`} title={name}>
      <span className="truncate">{base}</span>
      {hasExt && <span className="shrink-0">{ext}</span>}
    </span>
  )
}
