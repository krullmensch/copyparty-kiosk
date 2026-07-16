import { useEffect, useRef, useState } from 'react'
import { Moon, Sun, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GoeyToaster } from 'goey-toast'
import { FileBrowserPane } from './components/FileBrowserPane'
import { RemoteBrowserPane } from './components/RemoteBrowserPane'
import { OpticalDropZone } from './components/OpticalDropZone'
import { DvdRipBanner } from './components/DvdRipBanner'
import { AudioCdBanner } from './components/AudioCdBanner'
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

function App(): React.JSX.Element {
  const drives = useDrives()
  const caps = useAgoraCapabilities()
  // The Agora host (hostname/IP) is configurable at runtime via the admin panel
  // and persisted in ~/.agora/host, so the app needs no hardcoded address and
  // stays portable across networks. null while the persisted value is loading.
  const [agoraHost, setAgoraHost] = useState<string | null>(null)
  const copypartyUrl = agoraHost ? `http://${agoraHost}:3923` : null
  const [remoteReady, setRemoteReady] = useState(false)
  // Bumping retryNonce re-runs the connect effect for an immediate reconnect.
  const [retryNonce, setRetryNonce] = useState(0)
  const [connectAttempts, setConnectAttempts] = useState(0)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const logoClicks = useRef<{ n: number; t: number }>({ n: 0, t: 0 })
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useUploadProgress()

  useEffect(() => {
    void window.api.config.getHost().then(setAgoraHost)
  }, [])

  // 5 quick clicks on the title opens the admin panel. Available on every kiosk:
  // clients use it to point at the Agora host, the main kiosk also to reset the
  // session.
  const onLogoClick = (): void => {
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

  // Persist a new Agora host (admin-password gated) and force an immediate
  // reconnect to it.
  const changeHost = async (
    host: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const res = await window.api.config.setHost(host, password)
    if (res.ok) {
      setRemoteReady(false)
      setAgoraHost(res.host)
    }
    return { ok: res.ok, error: res.error }
  }

  useEffect(() => {
    if (!copypartyUrl) return
    let cancelled = false
    void (async () => {
      let attempt = 0
      while (!cancelled) {
        attempt++
        setConnectAttempts(attempt)
        const res = await window.api.cpp.connect(copypartyUrl)
        if (cancelled) return
        if (res.ok) {
          setConnectError(null)
          setRemoteReady(true)
          return
        }
        setConnectError(res.message ?? `Fehler ${res.status}`)
        await new Promise((r) => setTimeout(r, 2000))
      }
    })()
    return () => {
      cancelled = true
      void window.api.cpp.disconnect(copypartyUrl)
    }
  }, [copypartyUrl, retryNonce])

  // Manual "reconnect now": drop the ready flag and re-run the connect effect,
  // so the user isn't stuck waiting out the 2s auto-retry cycle.
  const retryConnect = (): void => {
    setRemoteReady(false)
    setRetryNonce((n) => n + 1)
  }

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
  // Audio CDs never mount either, but are a rip source, not a burn target.
  const burnDrive = drives.find((d) => d.isOptical && !d.mountpoints[0] && !d.isAudioCd) ?? null

  // A drive holding an audio CD (CDDA, no mountpoint) offers a rip-to-FLAC action.
  const audioCdDrive = drives.find((d) => d.isOptical && d.isAudioCd) ?? null

  // A mounted optical disc that's actually a video DVD (VIDEO_TS) offers a rip
  // action instead of/alongside plain browsing. Checked async since it needs a
  // main-process fs.existsSync call.
  const [isVideoDvd, setIsVideoDvd] = useState(false)
  useEffect(() => {
    if (dataDrive?.isOptical && usbPath) {
      let cancelled = false
      void window.api.dvdrip.isVideoDvd(usbPath).then((ok) => {
        if (!cancelled) setIsVideoDvd(ok)
      })
      return () => {
        cancelled = true
      }
    }
    setIsVideoDvd(false)
    return undefined
  }, [dataDrive?.isOptical, usbPath])

  const remotePane =
    remoteReady && copypartyUrl ? (
      <RemoteBrowserPane key={copypartyUrl} server={copypartyUrl} />
    ) : (
      <div className="text-ink-muted flex h-full flex-col items-center justify-center gap-3 text-label">
        <span>
          verbinde mit {copypartyUrl ?? '…'} …
          {connectAttempts > 1 && ` (Versuch ${connectAttempts})`}
        </span>
        {connectError && <span className="text-meta text-ink-faint">{connectError}</span>}
        <Button size="sm" variant="outline" onClick={retryConnect}>
          Erneut verbinden
        </Button>
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
          {isVideoDvd && dataDrive && copypartyUrl && (
            <DvdRipBanner drive={dataDrive} server={copypartyUrl} />
          )}
          {audioCdDrive && copypartyUrl && (
            <AudioCdBanner drive={audioCdDrive} server={copypartyUrl} />
          )}
          {burnDrive && <OpticalDropZone drive={burnDrive} />}
        </div>
      </div>
      {statsOpen && <AgoraStatsPanel onClose={() => setStatsOpen(false)} />}
      {adminOpen && (
        <AdminPanel
          host={agoraHost ?? ''}
          isMain={caps.isMain}
          onChangeHost={changeHost}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </PreviewProvider>
  )
}

export default App
