import { useEffect, useRef, useState } from 'react'
import { Moon, Sun, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GoeyToaster } from 'goey-toast'
import { FileBrowserPane } from './components/FileBrowserPane'
import { RemoteBrowserPane } from './components/RemoteBrowserPane'
import { OpticalDropZone } from './components/OpticalDropZone'
import { AgoraStatsPanel } from './components/AgoraStatsPanel'
import { AdminPanel } from './components/AdminPanel'
import { useDrives } from './hooks/useDrives'
import { useUploadProgress } from './hooks/useUploadProgress'
import { useAgoraCapabilities } from './hooks/useAgoraCapabilities'
import { usePreviewKeys } from './hooks/usePreviewKeys'
import { PreviewProvider } from './preview/PreviewProvider'

/** mountet die globalen Preview-Shortcuts innerhalb des PreviewProvider. */
function PreviewKeyboard(): null {
  usePreviewKeys()
  return null
}

// main kiosk addressed by mDNS so the app needs no per-network config
const COPYPARTY_URL = 'http://kiosk2.local:3923'

function App(): React.JSX.Element {
  const drives = useDrives()
  const caps = useAgoraCapabilities()
  const [remoteReady, setRemoteReady] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const logoClicks = useRef<{ n: number; t: number }>({ n: 0, t: 0 })
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useUploadProgress()

  // 5 quick clicks on the title opens the admin panel (main kiosk only)
  const onLogoClick = (): void => {
    if (!caps.isMain) return
    const now = Date.now()
    const c = logoClicks.current
    c.n = now - c.t < 2000 ? c.n + 1 : 1
    c.t = now
    if (c.n >= 5) {
      c.n = 0
      setAdminOpen(true)
    }
  }

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

  // Principle: one local removable source at a time — USB stick OR DVD, not
  // both. A USB stick (non-optical, mounted) takes precedence as the browse
  // pane; otherwise a mounted data disc is browsed.
  const dataDrive =
    drives.find((d) => !d.isOptical && d.mountpoints[0]) ??
    drives.find((d) => d.isOptical && d.mountpoints[0]) ??
    null
  const usbPath = dataDrive?.mountpoints[0]?.path ?? null
  // Burn target: an optical drive without a mounted data disc (i.e. blank/empty,
  // ready to write). A data disc is a browse source instead, not a burn target.
  const burnDrive = drives.find((d) => d.isOptical && !d.mountpoints[0]) ?? null

  const remotePane = remoteReady ? (
    <RemoteBrowserPane key={COPYPARTY_URL} server={COPYPARTY_URL} />
  ) : (
    <div className="text-ink-muted flex h-full items-center justify-center text-label">
      verbinde mit {COPYPARTY_URL} …
    </div>
  )

  return (
    <PreviewProvider>
      <PreviewKeyboard />
      <GoeyToaster richColors position="top-right" preset="smooth" showProgress />
      <div className="bg-background text-foreground flex h-screen flex-col">
        <header className="border-border bg-bg-page-tint flex items-center justify-between border-b px-4 py-2">
          <h1 className="text-h2 select-none" onClick={onLogoClick}>
            Agora
          </h1>
          <div className="flex items-center gap-1">
            {caps.trackingEnabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatsOpen(true)}
                title="Netz-Statistik"
                aria-label="Netz-Statistik"
              >
                <Users className="size-5" strokeWidth={1.25} />
              </Button>
            )}
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
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <div className="flex min-h-0 flex-1">
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
          {burnDrive && <OpticalDropZone drive={burnDrive} />}
        </div>
      </div>
      {statsOpen && <AgoraStatsPanel onClose={() => setStatsOpen(false)} />}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </PreviewProvider>
  )
}

export default App
