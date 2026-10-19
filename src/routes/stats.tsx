import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useApp } from '../app.tsx'
import { Card, color } from '../components/ui.tsx'
import type { ActivityEvent } from '../lib/model.ts'
import { daySummaries, sortEvents, type DaySummary } from '../lib/timeline.ts'
import { addDays, duration, isoLocal, short, startOfDay } from '../lib/time.ts'
import { load, persist } from '../lib/store.ts'

/** Stacking order; away time is shown together with breaks. */
const SERIES = [
  { key: 'sit', label: 'Sitting' },
  { key: 'stand', label: 'Standing' },
  { key: 'walk', label: 'Walking' },
  { key: 'eat', label: 'Eating' },
  { key: 'break', label: 'Break / away' },
] as const
type SeriesKey = (typeof SERIES)[number]['key']

const RANGES = [7, 14, 30] as const
const CACHE_KEY = 'stretch.stats'

function value(d: DaySummary, key: SeriesKey) {
  return key === 'break' ? d.totals.break + d.totals.away : d.totals[key]
}

function useHistory(days: number) {
  const [events, setEvents] = useState<ActivityEvent[]>(() =>
    load(CACHE_KEY, []),
  )
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    const from = encodeURIComponent(
      isoLocal(addDays(startOfDay(Date.now()), -(days - 1))),
    )
    fetch(`/api/events?from=${from}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: ActivityEvent[]) => {
        if (cancelled) return
        setEvents(data)
        setFailed(false)
        persist(CACHE_KEY, data)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [days])
  return { events, failed }
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-line">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export function StatsPage() {
  const { store, engine } = useApp()
  const [days, setDays] = useState<(typeof RANGES)[number]>(7)
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const { events, failed } = useHistory(days)
  const settings = store.settings

  // History from the server, plus today's live changes from the store.
  const summaries = useMemo(() => {
    const byId = new Map(events.map((e) => [e.id, e]))
    for (const e of store.events) byId.set(e.id, e)
    const from = addDays(startOfDay(engine.now), -(days - 1))
    return daySummaries(
      sortEvents([...byId.values()]),
      from,
      days,
      engine.now,
      settings,
    ).reverse()
  }, [events, store.events, days, engine.now, settings])

  const tracked = summaries.filter((d) => d.tracked > 0)
  const avg = (key: SeriesKey) =>
    tracked.length
      ? tracked.reduce((a, d) => a + value(d, key), 0) / tracked.length
      : 0
  const hits = tracked.filter(
    (d) =>
      d.totals.stand >= settings.targets.stand &&
      d.totals.walk >= settings.targets.walk,
  ).length
  const longest = tracked.length
    ? tracked.reduce((a, d) => a + d.longestStill, 0) / tracked.length
    : 0
  const max = Math.max(
    60,
    ...summaries.map((d) => SERIES.reduce((a, s) => a + value(d, s.key), 0)),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div
          className="flex rounded-xl bg-card p-1 ring-1 ring-line"
          role="radiogroup"
          aria-label="Range"
        >
          {RANGES.map((r) => (
            <button
              key={r}
              role="radio"
              aria-checked={days === r}
              onClick={() => setDays(r)}
              className={`rounded-lg px-3 py-1.5 text-sm ${days === r ? 'bg-surface font-medium shadow-sm' : 'text-ink-2'}`}
            >
              {r} days
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <a
          href="/api/export.csv"
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-card hover:text-ink"
        >
          <Download size={16} /> CSV
        </a>
      </div>
      {failed && (
        <p className="text-xs text-ink-3">
          Offline: showing the history saved on this device.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Sitting / day" value={short(avg('sit'))} />
        <Tile
          label="Standing / day"
          value={short(avg('stand'))}
          hint={`target ${short(settings.targets.stand)}`}
        />
        <Tile
          label="Walking / day"
          value={short(avg('walk'))}
          hint={`target ${short(settings.targets.walk)}`}
        />
        <Tile
          label="Longest still"
          value={short(longest)}
          hint={`${hits} of ${tracked.length} days hit targets`}
        />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Time per day</h2>
          <button
            className="text-xs text-ink-2 underline"
            onClick={() => setTable((t) => !t)}
          >
            {table ? 'Show chart' : 'Show table'}
          </button>
        </div>
        <ul
          className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2"
          aria-label="Legend"
        >
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: color(s.key) }}
              />
              {s.label}
            </li>
          ))}
        </ul>
        {table ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-ink-2">
                <tr>
                  <th className="py-1 text-left font-normal">Day</th>
                  {SERIES.map((s) => (
                    <th key={s.key} className="py-1 text-right font-normal">
                      {s.label}
                    </th>
                  ))}
                  <th className="py-1 text-right font-normal">Longest still</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summaries.map((d) => (
                  <tr key={d.day}>
                    <td className="py-1.5">{dayLabel(d.start)}</td>
                    {SERIES.map((s) => (
                      <td key={s.key} className="py-1.5 text-right">
                        {value(d, s.key) ? short(value(d, s.key)) : '–'}
                      </td>
                    ))}
                    <td className="py-1.5 text-right">
                      {d.longestStill ? short(d.longestStill) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul
            className="flex flex-col gap-1.5"
            onMouseLeave={() => setHover(null)}
          >
            {summaries.map((d) => (
              <li key={d.day} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-ink-2">
                  {dayLabel(d.start)}
                </span>
                <div className="flex h-5 flex-1 gap-[2px]">
                  {d.tracked === 0 && (
                    <span className="text-xs leading-5 text-ink-3">–</span>
                  )}
                  {SERIES.map((s) => {
                    const v = value(d, s.key)
                    if (v < 0.5) return null
                    const text = `${dayLabel(d.start)} · ${s.label} ${duration(v)}`
                    return (
                      <div
                        key={s.key}
                        role="img"
                        aria-label={text}
                        title={text}
                        onMouseEnter={() => setHover(text)}
                        className="h-full rounded-[4px] first:rounded-l-[4px]"
                        style={{
                          width: `${(v / max) * 100}%`,
                          background: color(s.key),
                        }}
                      />
                    )
                  })}
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-2">
                  {d.tracked ? short(d.tracked) : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!table && (
          <p className="mt-2 min-h-4 text-xs text-ink-2">{hover ?? ''}</p>
        )}
      </Card>
    </div>
  )
}

function dayLabel(ms: number) {
  const d = new Date(ms)
  const today = startOfDay(Date.now())
  if (ms === today) return 'Today'
  if (ms === addDays(today, -1)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  })
}
