import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  onConnected: (server: string) => void
}

export function RemoteLoginForm({ onConnected }: Props): React.JSX.Element {
  const [server, setServer] = useState('http://localhost:3923')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await window.api.cpp.connect(server, password || undefined)
    setBusy(false)
    if (res.ok) {
      onConnected(server.replace(/\/+$/, ''))
    } else {
      setError(res.message || `Failed (HTTP ${res.status})`)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-card border-border flex h-full flex-col justify-center gap-4 rounded-lg border p-6"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Connect to copyparty</h2>
        <p className="text-muted-foreground text-sm">Leave password empty for anonymous access.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="server">Server URL</Label>
        <Input
          id="server"
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="http://localhost:3923"
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && <div className="text-destructive text-sm">{error}</div>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </Button>
    </form>
  )
}
