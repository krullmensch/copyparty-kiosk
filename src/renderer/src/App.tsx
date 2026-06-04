import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GoeyToaster } from 'goey-toast'
import { FileBrowserPane } from './components/FileBrowserPane'
import { RemoteBrowserPane } from './components/RemoteBrowserPane'
import { useDrives } from './hooks/useDrives'
import { useUploadProgress } from './hooks/useUploadProgress'

const COPYPARTY_URL = 'http://192.168.178.61:3923'

function App(): React.JSX.Element {
  const drives = useDrives()
  const [remoteReady, setRemoteReady] = useState(false)
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useUploadProgress()

  const toggleTheme = (): void => {
    const next = !isDark
    document.documentElement.classList.toggle('dark', next)
    setIsDark(next)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      while (!cancelled) {
        const res = await window.api.cpp.connect(COPYPARTY_URL)
        if (cancelled) return
        if (res.ok) {
          setRemoteReady(true)
          return
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    })()
    return () => {
      cancelled = true
      void window.api.cpp.disconnect(COPYPARTY_URL)
    }
  }, [])

  const usbDrive = drives.find((d) => d.mountpoints[0]) ?? null
  const usbPath = usbDrive?.mountpoints[0]?.path ?? null

  const remotePane = remoteReady ? (
    <RemoteBrowserPane key={COPYPARTY_URL} server={COPYPARTY_URL} />
  ) : (
    <div className="text-ink-muted flex h-full items-center justify-center text-label">
      verbinde mit {COPYPARTY_URL} …
    </div>
  )

  return (
    <>
      <GoeyToaster richColors position="top-right" preset="smooth" showProgress />
      <div className="bg-background text-foreground flex h-screen flex-col">
        <header className="border-border bg-bg-page-tint flex items-center justify-between border-b px-4 py-2">
          <h1 className="text-h2">Agora</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            title={isDark ? 'Tag' : 'Nacht'}
            aria-label={isDark ? 'Tag' : 'Nacht'}
          >
            {isDark ? (
              <Sun className="size-5" strokeWidth={1.25} />
            ) : (
              <Moon className="size-5" strokeWidth={1.25} />
            )}
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
