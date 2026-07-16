import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatSize } from '../lib/format'
import { useAgoraStats } from '../hooks/useAgoraStats'

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h} h ${m} min`
  return `${m} min`
}

function Sparkline({ data }: { data: { live: number }[] }): React.JSX.Element | null {
  if (data.length < 2) return null
  const w = 240
  const h = 48
  const max = Math.max(1, ...data.map((d) => d.live))
  const step = w / (data.length - 1)
  const pts = data
    .map((d, i) => `${(i * step).toFixed(1)},${(h - (d.live / max) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="text-ink-leaf">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

function Stat({ n, label }: { n: number | string; label: string }): React.JSX.Element {
  return (
    <div className="text-center">
      <div className="text-h1 text-ink font-semibold tabular-nums">{n}</div>
      <div className="text-meta text-ink-muted mt-1 uppercase tracking-wider">{label}</div>
    </div>
  )
}

function fmtCount(n: number | undefined): number | string {
  return n == null ? '–' : n
}

/** overlay showing live Agora client stats fetched from Kiosk2. */
export function AgoraStatsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { stats, error, loading } = useAgoraStats(true)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="border-border bg-bg-surface w-[28rem] max-w-[90vw] rounded-lg border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-h2 text-ink">Agora · Netz</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X className="size-5" strokeWidth={1.25} />
          </Button>
        </div>

        {error && !stats && (
          <p className="text-destructive text-label py-8 text-center">
            Kiosk2 nicht erreichbar
            <span className="text-ink-faint mt-1 block">{error}</span>
          </p>
        )}

        {!stats && !error && (
          <p className="text-ink-muted text-label py-8 text-center">
            {loading ? 'Lade…' : 'Keine Daten'}
          </p>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-4 gap-4">
              <Stat n={stats.live} label="live" />
              <Stat n={stats.ever} label="jemals" />
              <Stat n={stats.peak_live} label="peak" />
              <Stat n={formatSize(stats.traffic_bytes)} label="Traffic" />
            </div>

            <div className="mt-6 flex justify-center">
              <Sparkline data={stats.history} />
            </div>

            <div className="border-border mt-6 grid grid-cols-4 gap-4 border-t pt-6">
              <Stat n={fmtCount(stats.usb_count)} label="USB-Sticks" />
              <Stat n={fmtCount(stats.disc_count)} label="Discs" />
              <Stat n={fmtCount(stats.files_transferred)} label="Dateien" />
              <Stat n={stats.bytes_transferred != null ? formatSize(stats.bytes_transferred) : '–'} label="Daten" />
            </div>

            {stats.by_ext && stats.by_ext.length > 0 && (
              <div className="mt-6">
                <div className="text-meta text-ink-muted mb-2 uppercase tracking-wider">
                  Top-Formate
                </div>
                <div className="flex flex-wrap gap-2">
                  {stats.by_ext.map(({ ext, count, bytes }) => (
                    <span
                      key={ext}
                      className="border-border text-ink-faint bg-bg-page rounded-full border px-2 py-0.5 text-meta"
                    >
                      {ext} ×{count} ({formatSize(bytes)})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-meta text-ink-faint mt-6 flex justify-between">
              <span>
                {stats.session ? `Session ${stats.session.id}` : 'keine Session'}
                {stats.session && ` · ${fmtUptime(stats.session.uptime_s)}`}
              </span>
              <span>
                {stats.stale_s == null
                  ? 'keine Daten'
                  : stats.stale_s > 90
                    ? `Poller still (${stats.stale_s}s)`
                    : `vor ${stats.stale_s}s`}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
