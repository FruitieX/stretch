import { useState } from 'react'
import { useApp } from '../app.tsx'
import { color } from './ui.tsx'
import { DOING, type Activity } from '../lib/model.ts'
import { HOUR, MINUTE, atClock, clock, duration } from '../lib/time.ts'

interface Mark {
  activity: Activity
  start: number
  end: number
  planned: boolean
}

/**
 * Today on one line: what happened (solid) and the tentative rest of the
 * day (faded), from the workday start to its end.
 */
export function DayBar() {
  const { engine, store } = useApp()
  const { today, preview } = engine.plan
  const [hover, setHover] = useState<Mark | null>(null)
  const now = engine.now
  const marks: Mark[] = [
    ...today.map((s) => ({
      activity: s.activity,
      start: s.start,
      end: s.end,
      planned: false,
    })),
    ...preview
      .filter((b) => b.end > now)
      .map((b) => ({
        activity: b.activity,
        start: Math.max(b.start, now),
        end: b.end,
        planned: true,
      })),
  ]
  const from = Math.min(
    atClock(now, store.settings.workdayStart),
    ...marks.map((m) => m.start),
  )
  const to = Math.max(
    atClock(now, store.settings.workdayEnd),
    now,
    ...marks.map((m) => m.end),
  )
  const span = Math.max(1, to - from)
  const pos = (t: number) => ((t - from) / span) * 100
  const hours: number[] = []
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) hours.push(t)

  return (
    <div>
      <div
        className="relative h-7 rounded-md bg-surface"
        onMouseLeave={() => setHover(null)}
      >
        {marks.map((m, i) => (
          <div
            key={i}
            role="img"
            aria-label={label(m)}
            title={label(m)}
            onMouseEnter={() => setHover(m)}
            className="absolute inset-y-0 rounded-[4px] border-x border-[var(--card)]"
            style={{
              left: `${pos(m.start)}%`,
              width: `${Math.max(0.4, pos(m.end) - pos(m.start))}%`,
              background: color(m.activity),
              opacity: m.planned ? 0.28 : 1,
            }}
          />
        ))}
        <div
          className="absolute -inset-y-1 w-0.5 rounded bg-ink"
          style={{ left: `${pos(now)}%` }}
          aria-hidden
        />
      </div>
      <div
        className="relative mt-1 h-4 text-[10px] tabular-nums text-ink-3"
        aria-hidden
      >
        {hours.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${pos(t)}%` }}
          >
            {new Date(t).getHours()}
          </span>
        ))}
      </div>
      <p className="mt-1 min-h-5 text-xs text-ink-2">
        {hover
          ? label(hover)
          : marks.some((m) => m.planned)
            ? 'Faded: a possible rest of the day.'
            : ''}
      </p>
    </div>
  )
}

function label(m: Mark) {
  const what = DOING[m.activity]
  return `${clock(m.start)}–${clock(m.end)} · ${m.planned ? `Maybe ${what.toLowerCase()}` : what} · ${duration((m.end - m.start) / MINUTE)}`
}
