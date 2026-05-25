import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GoeyToaster } from 'goey-toast'
import { FileBrowserPane } from './components/FileBrowserPane'
import { RemoteBrowserPane } from './components/RemoteBrowserPane'
import { RemoteLoginForm } from './components/RemoteLoginForm'
import { useDrives } from './hooks/useDrives'
import { useUploadProgress } from './hooks/useUploadProgress'

function App(): React.JSX.Element {
  const drives = useDrives()
  const [remoteServer, setRemoteServer] = useState<string | null>(null)
  useUploadProgress()

  const disconnectRemote = (): void => {
    if (remoteServer) void window.api.cpp.disconnect(remoteServer)
    setRemoteServer(null)
  }

  const usbDrive = drives.find((d) => d.mountpoints[0]) ?? null
  const usbPath = usbDrive?.mountpoints[0]?.path ?? null

  const remotePane = remoteServer ? (
    <RemoteBrowserPane
      key={remoteServer}
      server={remoteServer}
      onDisconnect={disconnectRemote}
    />
  ) : (
    <RemoteLoginForm onConnected={setRemoteServer} />
  )

  return (
    <>
      <GoeyToaster richColors position="top-right" preset="smooth" showProgress />
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

        <div className="flex min-h-0 flex-1 p-3">
          {usbPath ? (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              <section className="min-h-0">
                <FileBrowserPane key={usbPath} rootPath={usbPath} />
              </section>
              <section className="min-h-0">{remotePane}</section>
            </div>
          ) : (
            <section className="min-h-0 min-w-0 flex-1">{remotePane}</section>
          )}
        </div>
      </div>
    </>
  )
}

export default App
