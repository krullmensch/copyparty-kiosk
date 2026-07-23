import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { PagePlusIn } from 'iconoir-react'

const CdIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 36 36" {...props}>
    <path d="M18,2A16,16,0,1,0,34,18,16,16,0,0,0,18,2Zm0,30A14,14,0,1,1,32,18,14,14,0,0,1,18,32Z" />
    <path d="M22.33,18a4.46,4.46,0,1,0-4.45,4.46A4.46,4.46,0,0,0,22.33,18ZM17.88,20.9A2.86,2.86,0,1,1,20.73,18,2.86,2.86,0,0,1,17.88,20.9Z" />
    <path d="M17.88,7.43H18V5.84h-.12A12.21,12.21,0,0,0,5.68,17.75h1.6A10.61,10.61,0,0,1,17.88,7.43Z" />
    <path d="M30.08,18H28.49v0A10.61,10.61,0,0,1,18.25,28.63v1.6A12.22,12.22,0,0,0,30.09,18S30.08,18,30.08,18Z" />
    <path d="M18,11V9.44h-.12a8.62,8.62,0,0,0-8.6,8.32h1.6a7,7,0,0,1,7-6.72Z" />
    <path d="M18.25,25v1.6A8.61,8.61,0,0,0,26.48,18v0h-1.6v0A7,7,0,0,1,18.25,25Z" />
  </svg>
)

const UsbIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg fill="currentColor" viewBox="0 0 1024 1024" {...props}>
    <path d="M760 432V144c0-17.7-14.3-32-32-32H296c-17.7 0-32 14.3-32 32v288c-66.2 0-120 52.1-120 116v356c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V548c0-24.3 21.6-44 48.1-44h495.8c26.5 0 48.1 19.7 48.1 44v356c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V548c0-63.9-53.8-116-120-116zm-424 0V184h352v248H336zm120-184h-48c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8zm160 0h-48c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8z"/>
  </svg>
)

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
    <>
      <div className="flex max-w-3xl flex-col items-center justify-center gap-6 sm:flex-row sm:items-center">
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
          <p className="text-body text-ink font-medium">Nur dein Handy dabei?</p>
          <p className="text-body text-ink-faint">
            Verbinde dich jetzt mit dem WLAN und Lege Dateien hier ab um sie zu übertragen
          </p>

          <div className="mt-4 rounded-xl border-2 border-dashed border-ink/20 bg-ink/5 p-6 flex flex-col items-center justify-center">
            <PagePlusIn className="size-10 text-ink-muted" strokeWidth={1.5} />
          </div>
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

      <div className="absolute bottom-0 left-16 flex flex-col items-center translate-y-[45%]">
        <span className="text-meta font-bold text-ink-muted mb-4 translate-y-[-10px] uppercase tracking-wider">Lege eine CD oder DVD ein</span>
        <CdIcon className="size-48 text-ink-faint/30" />
      </div>

      <div className="absolute bottom-0 right-16 flex flex-col items-center translate-y-[45%]">
        <span className="text-meta font-bold text-ink-muted mb-4 translate-y-[-10px] uppercase tracking-wider">Stecke einen USB Stick an</span>
        <UsbIcon className="size-48 text-ink-faint/30" />
      </div>
    </>
  )
}
