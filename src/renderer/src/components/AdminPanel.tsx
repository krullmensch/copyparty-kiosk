import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gooeyToast } from 'goey-toast'

/** main-kiosk admin overlay: enter the setup password to reset the session. */
export function AdminPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doReset(): Promise<void> {
    setBusy(true)
    setError(null)
    const res = await window.api.agora.reset(password)
    setBusy(false)
    if (res.ok) {
      gooeyToast.success(`Session zurückgesetzt (neue Session ${res.session})`, { duration: 4000 })
      onClose()
    } else {
      setError(res.error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="border-border bg-bg-surface w-[26rem] max-w-[90vw] rounded-lg border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h2 text-ink">Admin</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X className="size-5" strokeWidth={1.25} />
          </Button>
        </div>

        <p className="text-label text-ink-muted mb-4">
          Session zurücksetzen: neue Session, alle bisherigen Beobachtungen werden gelöscht.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (password && !busy) void doReset()
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin-Passwort"
            autoFocus
          />
          {error && <p className="text-destructive text-meta mt-2">{error}</p>}
          <Button type="submit" variant="destructive" className="mt-4 w-full" disabled={!password || busy}>
            {busy ? 'Setze zurück…' : 'Session zurücksetzen'}
          </Button>
        </form>
      </div>
    </div>
  )
}
