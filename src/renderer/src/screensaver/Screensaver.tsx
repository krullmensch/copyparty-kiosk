import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GROUPS } from './manifest'
import { useScreensaverSuppressed } from './suppress'

const IDLE_MS = 8_000 // TEMP TEST — zurück auf 120_000 vor Produktivbetrieb

// Untertitel-Timing (schnell)
const WORD_MS = 380 // Abstand zwischen zwei Wort-Einblendungen
const HOLD_MS = 620 // Standzeit nach dem letzten Wort einer Gruppe
const GROUP_FADE_MS = 260 // Ausblenden der Gruppe vor der nächsten

// Grafik-Timeline (CD → USB), läuft parallel zu den Worten
const CD_START_MS = 8_000 // Verzögerung bis die CD hochfährt
const CD_SLIDE_MS = 900 // Dauer der Ein-/Ausfahrt
const CD_STAY_MS = 10_000 // Standzeit der CD, bevor sie wieder rausfährt
const USB_GAP_MS = 1_500 // Pause nach der CD, bevor der USB-Stick kommt

/**
 * Idle-Erkennung im Renderer. Zählt bei Inaktivität 2 min herunter; jede Maus-/
 * Tastatureingabe setzt zurück. Solange `suppressed` (offene Medien-Vorschau
 * oder QR-Code) gilt, wird kein Timer gestartet.
 */
function useIdle(suppressed: boolean): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer: number | undefined
    const reset = (): void => {
      window.clearTimeout(timer)
      setIdle(false)
      if (!suppressed) timer = window.setTimeout(() => setIdle(true), IDLE_MS)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [suppressed])
  return idle
}

/** CD-Icon (viewBox 0 0 36 36, svgrepo cd-dvd-line), schwarz. */
function CdIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 36 36" fill="#000" width="100%" height="100%" aria-hidden>
      <path d="M18,2A16,16,0,1,0,34,18,16,16,0,0,0,18,2Zm0,30A14,14,0,1,1,32,18,14,14,0,0,1,18,32Z" />
      <path d="M22.33,18a4.46,4.46,0,1,0-4.45,4.46A4.46,4.46,0,0,0,22.33,18ZM17.88,20.9A2.86,2.86,0,1,1,20.73,18,2.86,2.86,0,0,1,17.88,20.9Z" />
      <path d="M17.88,7.43H18V5.84h-.12A12.21,12.21,0,0,0,5.68,17.75h1.6A10.61,10.61,0,0,1,17.88,7.43Z" />
      <path d="M30.08,18H28.49v0A10.61,10.61,0,0,1,18.25,28.63v1.6A12.22,12.22,0,0,0,30.09,18S30.08,18,30.08,18Z" />
      <path d="M18,11V9.44h-.12a8.62,8.62,0,0,0-8.6,8.32h1.6a7,7,0,0,1,7-6.72Z" />
      <path d="M18.25,25v1.6A8.61,8.61,0,0,0,26.48,18v0h-1.6v0A7,7,0,0,1,18.25,25Z" />
    </svg>
  )
}

/** USB-Icon (viewBox 0 0 1024 1024, svgrepo), schwarz. */
function UsbIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 1024 1024" fill="#000" width="100%" height="100%" aria-hidden>
      <path d="M760 432V144c0-17.7-14.3-32-32-32H296c-17.7 0-32 14.3-32 32v288c-66.2 0-120 52.1-120 116v356c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V548c0-24.3 21.6-44 48.1-44h495.8c26.5 0 48.1 19.7 48.1 44v356c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V548c0-63.9-53.8-116-120-116zm-424 0V184h352v248H336zm120-184h-48c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8zm160 0h-48c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8z" />
    </svg>
  )
}

/**
 * Innerer Screensaver-Inhalt. Wird pro Session frisch gemountet (der Wrapper
 * unmountet zwischen den Sessions), daher startet jede Animation bei 0.
 */
function Stage(): React.JSX.Element {
  const [groupIdx, setGroupIdx] = useState(0)
  const [wordCount, setWordCount] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)
  const [scale, setScale] = useState(1)
  const [cdIn, setCdIn] = useState(false)
  const [usbIn, setUsbIn] = useState(false)
  const lineRef = useRef<HTMLDivElement>(null)

  // Untertitel-Loop
  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const wait = (ms: number): Promise<void> =>
      new Promise((r) => timers.push(window.setTimeout(r, ms)))
    void (async () => {
      let g = 0
      while (!cancelled) {
        const group = GROUPS[g]
        setGroupIdx(g)
        setFadeOut(false)
        setWordCount(0)
        for (let i = 1; i <= group.length && !cancelled; i++) {
          setWordCount(i)
          await wait(WORD_MS)
        }
        if (cancelled) break
        await wait(HOLD_MS)
        if (cancelled) break
        setFadeOut(true)
        await wait(GROUP_FADE_MS)
        g = (g + 1) % GROUPS.length
      }
    })()
    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  // Grafik-Timeline: CD hoch → 10 s → CD runter → USB hoch (bleibt)
  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const wait = (ms: number): Promise<void> =>
      new Promise((r) => timers.push(window.setTimeout(r, ms)))
    void (async () => {
      await wait(CD_START_MS)
      if (cancelled) return
      setCdIn(true)
      await wait(CD_SLIDE_MS + CD_STAY_MS)
      if (cancelled) return
      setCdIn(false)
      await wait(CD_SLIDE_MS + USB_GAP_MS)
      if (cancelled) return
      setUsbIn(true)
    })()
    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  // Auto-Fit: 190px-Zeile auf Viewport-Breite herunterskalieren, falls zu breit.
  // Versteckte Worte reservieren bereits Platz, daher pro Gruppe stabil.
  useLayoutEffect(() => {
    const el = lineRef.current
    if (!el) return
    const avail = window.innerWidth * 0.9
    const w = el.scrollWidth
    setScale(w > avail ? avail / w : 1)
  }, [groupIdx])

  const group = GROUPS[groupIdx] ?? []

  return (
    <>
      <div
        style={{
          transform: `scale(${scale})`,
          // Kein transform-transition: Scale wird beim Gruppenwechsel vor dem
          // Paint gesetzt und soll NICHT animiert werden (sonst „zoomt" die
          // neue Gruppe rein). Nur das Gruppen-Fade wird getweent.
          transition: 'opacity 200ms ease',
          opacity: fadeOut ? 0 : 1,
          willChange: 'opacity'
        }}
      >
        <div
          key={groupIdx}
          ref={lineRef}
          style={{
            whiteSpace: 'nowrap',
            fontFamily: "'Averia Serif Libre', serif",
            fontWeight: 700,
            fontSize: '120px',
            letterSpacing: '-0.05em',
            lineHeight: 1,
            color: '#000'
          }}
        >
          {group.map((word, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                marginRight: i < group.length - 1 ? '0.28em' : 0,
                opacity: i < wordCount ? 1 : 0,
                transform: i < wordCount ? 'translateY(0)' : 'translateY(0.12em)',
                transition: 'opacity 220ms ease, transform 220ms ease'
              }}
            >
              {word}
            </span>
          ))}
        </div>
      </div>

      {/* CD — fährt von unten bis zur Hälfte herein und dreht sich */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 0,
          width: '42vmin',
          height: '42vmin',
          transform: `translateX(-50%) translateY(${cdIn ? '50%' : '100%'})`,
          transition: `transform ${CD_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          willChange: 'transform'
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            animation: cdIn ? 'sv-nudge 2.6s ease-in-out 900ms infinite' : 'none'
          }}
        >
          <div style={{ width: '100%', height: '100%', animation: 'sv-spin 4s linear infinite' }}>
            <CdIcon />
          </div>
        </div>
      </div>

      {/* USB-Stick — fährt herein und stupst als Hinweis nach oben */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 0,
          width: '34vmin',
          height: '34vmin',
          transform: `translateX(-50%) translateY(${usbIn ? '45%' : '100%'})`,
          transition: `transform ${CD_SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          willChange: 'transform'
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            animation: usbIn ? 'sv-nudge 2.6s ease-in-out 900ms infinite' : 'none'
          }}
        >
          <UsbIcon />
        </div>
      </div>
    </>
  )
}

/**
 * Screensaver-Overlay mit Blende: weißer Hintergrund faded ein, dann läuft die
 * Stage. `active` von außen (Idle) steuert Ein-/Ausblenden; die Stage bleibt
 * während der 400 ms Ausblende noch gemountet.
 */
function Screensaver({ active }: { active: boolean }): React.JSX.Element | null {
  const [render, setRender] = useState(active)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (active) {
      setRender(true)
      // Doppel-rAF: erst mounten (opacity 0), dann auf 1 faden.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      return () => cancelAnimationFrame(id)
    }
    if (render) {
      setVisible(false)
      const t = window.setTimeout(() => setRender(false), 400)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [active, render])

  if (!render) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 400ms ease'
      }}
    >
      <style>{`
        @keyframes sv-spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        @keyframes sv-nudge {
          0%, 58%, 100% { transform: translateY(0) }
          66% { transform: translateY(-7%) }
          74% { transform: translateY(0) }
          82% { transform: translateY(-7%) }
          90% { transform: translateY(0) }
        }
      `}</style>
      {visible && <Stage />}
    </div>
  )
}

/** In App mounten: verkabelt Idle + Suppression und rendert das Overlay. */
export function ScreensaverController(): React.JSX.Element {
  const suppressed = useScreensaverSuppressed()
  const idle = useIdle(suppressed)
  return <Screensaver active={idle} />
}
