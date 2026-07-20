import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

/**
 * Empty-State des Datentausch-Trays (non-USB): zwei QR-Codes zum
 * Mobile-Upload — links WLAN-Join, rechts direkter Link zur Upload-Seite.
 *
 * Die Upload-URL wird zur Laufzeit vom Main-Prozess geholt (agora-Host → IPv4),
 * nicht hardcoded — so bleibt sie beim Netz-Wechsel korrekt und routbar fürs Handy.
 */
export function MobileUploadPanel(): React.JSX.Element {
  const [uploadUrl, setUploadUrl] = useState<string | null>(null)

  useEffect(() => {
    window.api.config
      .mobileUploadUrl()
      .then(setUploadUrl)
      .catch(() => setUploadUrl(null))
  }, [])

  return (
    <div className="flex max-w-3xl flex-col items-center justify-center gap-6 sm:flex-row sm:items-start">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-input bg-white p-4">
          <QRCodeSVG
            value="WIFI:S:Agora;T:nopass;;"
            size={180}
            level="M"
            marginSize={2}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
        </div>
        <span className="text-label text-ink text-center">
          1. Mit WLAN <strong>Agora</strong> verbinden
        </span>
      </div>

      <div className="flex max-w-xs flex-col items-center gap-2 text-center">
        <p className="text-body text-ink font-medium">Schon im Agora-Netz?</p>
        <p className="text-body text-ink-faint">
          Dann scanne rechts oder öffne folgende URL in deinem Browser:
        </p>
        <p className="text-label text-ink-muted break-all">{uploadUrl ?? '…'}</p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="rounded-input bg-white p-4">
          {uploadUrl ? (
            <QRCodeSVG
              value={uploadUrl}
              size={180}
              level="M"
              marginSize={2}
              bgColor="#FFFFFF"
              fgColor="#000000"
            />
          ) : (
            <div className="flex size-[180px] items-center justify-center">
              <span className="text-label text-ink-faint">lädt…</span>
            </div>
          )}
        </div>
        <span className="text-label text-ink text-center">2. Upload öffnen</span>
      </div>
    </div>
  )
}
