import { useEffect, useState } from 'react'
import { Home, HardDrive, Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { FileBrowserPane } from './components/FileBrowserPane'
import { RemoteBrowserPane } from './components/RemoteBrowserPane'
import { RemoteLoginForm } from './components/RemoteLoginForm'
import { useDrives } from './hooks/useDrives'

function App(): React.JSX.Element {
  const drives = useDrives()
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [remoteServer, setRemoteServer] = useState<string | null>(null)

  useEffect(() => {
    window.api.fs.home().then(setRootPath)
  }, [])

  const disconnectRemote = (): void => {
    if (remoteServer) void window.api.cpp.disconnect(remoteServer)
    setRemoteServer(null)
  }

  return (
    <>
      <Toaster richColors position="top-right" />
    <div className="bg-background flex h-screen flex-col">
      <header className="border-border flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">copyparty-kiosk</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          dark
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <aside className="border-border bg-card flex w-56 shrink-0 flex-col gap-1 rounded-lg border p-2">
          <div className="text-muted-foreground px-2 py-1 text-xs font-medium uppercase">
            Locations
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => window.api.fs.home().then(setRootPath)}
          >
            <Home className="size-4" /> Home
          </Button>

          <div className="text-muted-foreground mt-2 px-2 py-1 text-xs font-medium uppercase">
            Drives
          </div>
          {drives.length === 0 && (
            <div className="text-muted-foreground px-2 py-1 text-xs">none</div>
          )}
          {drives.map((d) => {
            const mp = d.mountpoints[0]
            return (
              <Button
                key={d.id}
                variant="ghost"
                size="sm"
                className="justify-start"
                disabled={!mp}
                onClick={() => mp && setRootPath(mp.path)}
                title={d.device}
              >
                {d.isUSB ? <Usb className="size-4" /> : <HardDrive className="size-4" />}
                <span className="truncate">{mp?.label || d.description || d.device}</span>
              </Button>
            )
          })}
        </aside>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
          <section className="min-h-0">
            {rootPath ? (
              <FileBrowserPane key={rootPath} rootPath={rootPath} />
            ) : (
              <div className="text-muted-foreground p-4 text-sm">Initializing…</div>
            )}
          </section>

          <section className="min-h-0">
            {remoteServer ? (
              <RemoteBrowserPane
                key={remoteServer}
                server={remoteServer}
                onDisconnect={disconnectRemote}
              />
            ) : (
              <RemoteLoginForm onConnected={setRemoteServer} />
            )}
          </section>
        </div>
      </div>
    </div>
    </>
  )
}

export default App
