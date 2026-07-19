import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { PARAGRAPHS } from './manifest'
import { useScreensaverSuppressed } from './suppress'
import '@fontsource/inter'
import '@fontsource/averia-serif-libre/700.css'

const IDLE_MS = 120_000 // 2 min Inaktivität bis Screensaver

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

function Stage(): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isFading, setIsFading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const wait = (ms: number): Promise<void> =>
      new Promise((r) => {
        if (ms <= 0) r()
        else timers.push(window.setTimeout(r, ms))
      })

    void (async () => {
      while (!cancelled) {
        for (let i = 0; i < PARAGRAPHS.length && !cancelled; i++) {
          setActiveIndex(i)
          setIsFading(false)

          const readTime = PARAGRAPHS[i].endMs - PARAGRAPHS[i].startMs
          // Ensure it stays at least a bit, max out at something reasonable or just use exact SRT
          await wait(Math.max(readTime, 4000))
          if (cancelled) break

          setIsFading(true)
          await wait(600) // fade out active paragraph
          if (cancelled) break
          
          // Before sliding up the next one, maybe a tiny gap
          await wait(200)
          if (cancelled) break
        }
        if (cancelled) break
        // End of loop pause
        await wait(2000)
      }
    })()
    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-[#F8F8F8] overflow-hidden">
      {/* Logo */}
      <div className="absolute top-12 left-12 font-['Averia_Serif_Libre'] font-bold text-black text-5xl tracking-tight z-20">
        Agora
      </div>

      {/* Fade overlay am unteren Rand */}
      <div className="pointer-events-none absolute bottom-0 left-0 w-full h-[35vh] bg-gradient-to-t from-[#F8F8F8] via-[#F8F8F8]/80 to-transparent z-10" />

      {/* Action Pille */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-[#000000] text-[#F8F8F8] font-['Averia_Serif_Libre'] text-3xl font-bold px-10 py-4 rounded-full z-20">
        Jetzt starten!
      </div>

      {PARAGRAPHS.map((p, i) => {
        const isActive = i === activeIndex
        const isNext = i === activeIndex + 1

        if (!isActive && !isNext) return null

        return (
          <motion.div
            key={i}
            layout
            initial={{ opacity: 0, y: 150 }}
            animate={{
              opacity: isActive ? (isFading ? 0 : 1) : 1,
              y: isActive ? 0 : 250,
              color: isActive ? '#000000' : '#DDDDDD',
            }}
            transition={{
              duration: 1.2,
              ease: [0.22, 1, 0.36, 1],
              opacity: { duration: isActive && isFading ? 0.6 : 1.0 }
            }}
            className="absolute w-full max-w-4xl text-justify font-['Inter'] text-[2.5rem] leading-[1.6]"
            style={{ textAlignLast: 'left' }}
          >
            {p.text}
          </motion.div>
        )
      })}
    </div>
  )
}

function Screensaver({ active }: { active: boolean }): React.JSX.Element | null {
  const [render, setRender] = useState(active)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (active) {
      setRender(true)
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
        background: '#F8F8F8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 400ms ease'
      }}
    >
      {visible && <Stage />}
    </div>
  )
}

export function ScreensaverController(): React.JSX.Element {
  const suppressed = useScreensaverSuppressed()
  const idle = useIdle(suppressed)
  return <Screensaver active={idle} />
}
