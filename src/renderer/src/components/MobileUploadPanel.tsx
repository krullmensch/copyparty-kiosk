import { QRCodeSVG } from 'qrcode.react'

const MOBILE_UPLOAD_URL = 'http://192.168.178.71:8080/up'

/**
 * Empty-State des Datentausch-Trays (non-USB): zwei QR-Codes zum
 * Mobile-Upload — links WLAN-Join, rechts direkter Link zur Upload-Seite.
 */
export function MobileUploadPanel(): React.JSX.Element {
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
        <p className="text-label text-ink-muted break-all">{MOBILE_UPLOAD_URL}</p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="rounded-input bg-white p-4">
          <QRCodeSVG
            value={MOBILE_UPLOAD_URL}
            size={180}
            level="M"
            marginSize={2}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
        </div>
        <span className="text-label text-ink text-center">2. Upload öffnen</span>
      </div>
    </div>
  )
}
