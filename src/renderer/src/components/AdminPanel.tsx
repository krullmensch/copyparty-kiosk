import { useState } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gooeyToast } from 'goey-toast'
import type { AgoraHostCandidate } from '../../../shared/types'

/**
 * Admin overlay (5x-click on the title). Every kiosk can set which Agora host
 * it connects to (list of copyparty servers on the LAN, or a typed IP/hostname);
 * the main kiosk additionally resets the tracking session.
 */
export function AdminPanel({
  host,
  isMain,
  onChangeHost,
  onClose
}: {
  host: string
  isMain: boolean
  onChangeHost: (host: string, password: string) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}): React.JSX.Element {
  const [hostInput, setHostInput] = useState(host)
  const [hostPassword, setHostPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [hostError, setHostError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [candidates, setCandidates] = useState<AgoraHostCandidate[] | null>(null)

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  async function applyHost(): Promise<void> {
    setConnecting(true)
    setHostError(null)
    const res = await onChangeHost(hostInput, hostPassword)
    setConnecting(false)
    if (res.ok) {
      gooeyToast.success(`Verbinde mit ${hostInput}…`, { duration: 3000 })
      onClose()
    } else {
      setHostError(res.error ?? 'Fehler')
    }
  }

  async function scan(): Promise<void> {
    setScanning(true)
    setCandidates(null)
    const hits = await window.api.config.scanHosts()
    setCandidates(hits)
    setScanning(false)
  }

  async function doReset(): Promise<void> {
    setBusy(true)
    setResetError(null)
    const res = await window.api.agora.reset(password)
    setBusy(false)
    if (res.ok) {
      gooeyToast.success(`Session zurückgesetzt (neue Session ${res.session})`, { duration: 4000 })
      onClose()
    } else {
      setResetError(res.error)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="border-border bg-bg-surface max-h-[90vh] w-[28rem] max-w-[90vw] overflow-y-auto rounded-card border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h2 text-ink">Admin</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X className="size-5" strokeWidth={1.25} />
          </Button>
        </div>

        {/* --- connection management (every kiosk) --- */}
        <section>
          <h3 className="text-label text-ink mb-1 font-medium">Agora-Verbindung</h3>
          <p className="text-meta text-ink-muted mb-3">
            Host, mit dem dieser Kiosk sich verbindet (copyparty :3923, Dashboard :8080).
            Hostname oder IP.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (hostInput.trim() && hostPassword && !connecting) void applyHost()
            }}
          >
            <Input
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              placeholder="kiosk2.local oder 192.168.178.71"
              autoFocus
            />
            <div className="mt-2 flex gap-2">
              <Input
                type="password"
                value={hostPassword}
                onChange={(e) => setHostPassword(e.target.value)}
                placeholder="Admin-Passwort"
              />
              <Button type="submit" disabled={!hostInput.trim() || !hostPassword || connecting}>
                {connecting ? '…' : 'Verbinden'}
              </Button>
            </div>
            {hostError && <p className="text-destructive text-meta mt-2">{hostError}</p>}
          </form>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-meta text-ink-faint">Geräte im Netzwerk (copyparty :3923)</span>
            <Button variant="ghost" size="sm" onClick={() => void scan()} disabled={scanning}>
              <RefreshCw
                className={`mr-1 size-4 ${scanning ? 'animate-spin' : ''}`}
                strokeWidth={1.5}
              />
              {scanning ? 'Suche…' : 'Scannen'}
            </Button>
          </div>

          <div className="mt-2">
            {candidates?.length === 0 && (
              <p className="text-meta text-ink-faint">Keine copyparty-Server gefunden.</p>
            )}
            {candidates?.map((c) => (
              <button
                key={c.ip}
                type="button"
                onClick={() => setHostInput(c.ip)}
                className="border-border hover:bg-bg-page-tint mb-1 flex w-full items-center justify-between rounded border px-3 py-2 text-left"
              >
                <span className="text-label text-ink">{c.name ?? c.ip}</span>
                <span className="text-meta text-ink-faint">{c.ip}</span>
              </button>
            ))}
          </div>
        </section>

        {/* --- session reset (main kiosk only) --- */}
        {isMain && (
          <section className="border-border mt-6 border-t pt-5">
            <h3 className="text-label text-ink mb-1 font-medium">Session zurücksetzen</h3>
            <p className="text-meta text-ink-muted mb-3">
              Neue Session, alle bisherigen Beobachtungen werden gelöscht.
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
              />
              {resetError && <p className="text-destructive text-meta mt-2">{resetError}</p>}
              <Button
                type="submit"
                variant="destructive"
                className="mt-3 w-full"
                disabled={!password || busy}
              >
                {busy ? 'Setze zurück…' : 'Session zurücksetzen'}
              </Button>
            </form>
          </section>
        )}
      </div>
    </div>
  )
}
