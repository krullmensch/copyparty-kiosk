import { useCallback, useEffect, useState } from 'react'
import { gooeyToast as toast } from 'goey-toast'
import type { FileMetadata, PreviewSource } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'

type Editable = { title: string; comment: string; author: string }

function toEditable(m: FileMetadata): Editable {
  return {
    title: m.common.title ?? '',
    comment: m.common.comment ?? '',
    author: m.common.author ?? ''
  }
}

export function MetadataPanel({ source }: { source: PreviewSource }): React.JSX.Element {
  const [meta, setMeta] = useState<FileMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Editable>({ title: '', comment: '', author: '' })
  const [baseline, setBaseline] = useState<Editable>({ title: '', comment: '', author: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const m = await window.api.preview.metadata(source)
      setMeta(m)
      const ed = toEditable(m)
      setForm(ed)
      setBaseline(ed)
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => {
    void load()
  }, [load])

  const dirty =
    form.title !== baseline.title ||
    form.comment !== baseline.comment ||
    form.author !== baseline.author

  const save = async (): Promise<void> => {
    const patch: Partial<FileMetadata['common']> = {}
    if (form.title !== baseline.title) patch.title = form.title
    if (form.comment !== baseline.comment) patch.comment = form.comment
    if (form.author !== baseline.author) patch.author = form.author
    setSaving(true)
    try {
      const res = await window.api.preview.writeMetadata(source, patch)
      if (res.ok) {
        toast.success('Metadaten gespeichert')
        await load()
      } else {
        toast.error(res.message ?? 'Speichern fehlgeschlagen')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-meta text-ink-muted p-4">Metadaten laden…</div>
  if (!meta) return <div className="text-meta text-ink-muted p-4">Keine Metadaten</div>

  const writable = meta.writable
  const rawEntries = Object.entries(meta.raw)

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-3">
            <Field label="Titel" value={form.title} disabled={!writable} onChange={(v) => setForm({ ...form, title: v })} />
            <Field label="Kommentar" value={form.comment} disabled={!writable} onChange={(v) => setForm({ ...form, comment: v })} />
            <Field label="Autor" value={form.author} disabled={!writable} onChange={(v) => setForm({ ...form, author: v })} />
          </div>

          {(meta.common.dimensions || meta.common.duration != null || meta.common.dateTaken) && (
            <div className="text-meta text-ink-muted flex flex-col gap-1">
              {meta.common.dimensions && <div>Abmessungen: {meta.common.dimensions}</div>}
              {meta.common.duration != null && <div>Dauer: {formatDuration(meta.common.duration)}</div>}
              {meta.common.dateTaken && <div>Datum: {meta.common.dateTaken}</div>}
            </div>
          )}

          {!writable && (
            <div className="text-meta text-ink-faint">
              Metadaten nur bei lokalen Dateien änderbar.
            </div>
          )}

          {rawEntries.length > 0 && (
            <div className="border-border border-t pt-3">
              <div className="text-meta text-ink-faint mb-2 uppercase tracking-wider">Rohdaten</div>
              <div className="flex flex-col gap-1">
                {rawEntries.map(([k, v]) => (
                  <div key={k} className="text-meta grid grid-cols-[9rem_1fr] gap-2">
                    <span className="text-ink-faint truncate">{k}</span>
                    <span className="text-ink-muted break-all">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {writable && (
        <div className="border-border border-t p-3">
          <Button className="w-full" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Speichert…' : 'Speichern'}
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-meta text-ink-faint">{label}</Label>
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function formatDuration(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}
