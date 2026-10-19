import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useApp } from '../app.tsx'
import { ActivityIcon, Button, color } from './ui.tsx'
import { DOING, LABELS, type Activity } from '../lib/model.ts'
import type { Row } from '../lib/backfill.ts'
import { MINUTE, atClock, clock, duration, startOfDay } from '../lib/time.ts'

const CHOICES: Activity[] = ['sit', 'stand', 'walk', 'eat', 'break']
const AGO = [5, 10, 15, 30]
/** Adjust is for longer backfills. */
const AGO_LONG = [15, 30, 60, 120]

const ago = (m: number) => (m < 60 ? `${m}m` : `${m / 60}h`)

/** One-tap "I started this earlier", shown right after switching. */
export function StartedEarlier() {
  const { engine } = useApp()
  const [error, setError] = useState<string | null>(null)
  const current = engine.plan.current
  if (!current) return null
  const dayStart = startOfDay(engine.now)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-ink-2">Started earlier?</span>
      {AGO.filter((m) => engine.now - m * MINUTE >= dayStart).map((m) => (
        <Button
          key={m}
          variant="quiet"
          className="!px-2.5 !py-1"
          onClick={() =>
            setError(
              engine.rewrite([
                { activity: current.activity, start: engine.now - m * MINUTE },
              ]),
            )
          }
        >
          {ago(m)} ago
        </Button>
      ))}
      {error && <span className="w-full text-xs text-alarm">{error}</span>}
    </div>
  )
}

/**
 * Rewrites the recent past as a sentence: "Sitting since 09:52, before that
 * standing since 08:50 …". Saving replaces whatever was recorded since the
 * earliest time.
 */
export function AdjustPast({ onClose }: { onClose: () => void }) {
  const { engine } = useApp()
  const now = engine.now
  const current = engine.plan.current!
  const [rows, setRows] = useState<Row[]>([
    { activity: current.activity, start: current.since },
  ])
  const [error, setError] = useState<string | null>(null)
  const dayStart = startOfDay(now)
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const last = rows[rows.length - 1]

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      {rows.map((row, i) => {
        const end = i === 0 ? now : rows[i - 1].start
        const steps = i === 0 ? AGO_LONG : [30, 60, 120]
        return (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-2xl bg-sunken/70 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-2">
                {i === 0 ? 'Now' : 'Before that'}
              </span>
              {i > 0 && (
                <button
                  className="text-ink-3 hover:text-ink"
                  aria-label="Remove"
                  onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label={i === 0 ? 'Doing now' : 'Doing before that'}
            >
              {CHOICES.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={row.activity === a}
                  onClick={() => set(i, { activity: a })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
                    row.activity === a
                      ? 'text-white ring-transparent'
                      : 'bg-card ring-line'
                  }`}
                  style={
                    row.activity === a ? { background: color(a) } : undefined
                  }
                >
                  <ActivityIcon activity={a} size={14} /> {LABELS[a]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <label className="flex items-center gap-2">
                since
                <input
                  type="time"
                  aria-label={i === 0 ? 'Since' : 'Before that since'}
                  value={clock(row.start)}
                  onChange={(e) => {
                    if (/^\d{1,2}:\d{2}$/.test(e.target.value))
                      set(i, { start: atClock(now, e.target.value) })
                  }}
                  className="rounded-full bg-card px-3 py-1 ring-1 ring-line"
                />
              </label>
              {steps
                .filter((m) => end - m * MINUTE >= dayStart)
                .map((m) => (
                  <Button
                    key={m}
                    variant="ghost"
                    className="!px-2 !py-1"
                    onClick={() => set(i, { start: end - m * MINUTE })}
                  >
                    {i === 0 ? `${ago(m)} ago` : `${ago(m)} before`}
                  </Button>
                ))}
              <span className="ml-auto text-xs tabular-nums text-ink-3">
                {end > row.start ? duration((end - row.start) / MINUTE) : ''}
              </span>
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          disabled={last.start - 15 * MINUTE < dayStart}
          onClick={() =>
            setRows((r) => [
              ...r,
              {
                activity: last.activity === 'sit' ? 'stand' : 'sit',
                start: Math.max(dayStart, last.start - 60 * MINUTE),
              },
            ])
          }
        >
          <Plus size={16} /> Before that…
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            const message = engine.rewrite(rows)
            setError(message)
            if (!message) onClose()
          }}
        >
          Save
        </Button>
      </div>
      <p className="text-xs text-ink-3">
        {error ? (
          <span className="text-alarm">{error}</span>
        ) : (
          `${rows
            .map((r) => DOING[r.activity].toLowerCase())
            .join(', then before that ')
            .replace(/^./, (c) =>
              c.toUpperCase(),
            )}. Replaces anything recorded since ${clock(last.start)}.`
        )}
      </p>
    </div>
  )
}
