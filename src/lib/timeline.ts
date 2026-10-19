import type { Activity, ActivityEvent, Settings } from './model.ts'
import { ACTIVITIES } from './model.ts'
import { HOUR, MINUTE, addDays, atClock, dayKey, startOfDay } from './time.ts'

export interface Span {
  eventId: string
  activity: Activity
  source: ActivityEvent['source']
  start: number
  end: number
  /** Still in progress (the latest change, today). */
  open: boolean
}

export const time = (e: ActivityEvent) => Date.parse(e.at)

export function sortEvents(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort(
    (a, b) => time(a) - time(b) || a.id.localeCompare(b.id),
  )
}

/**
 * Turns activity changes into spans clipped to [from, to). A change lasts
 * until the next one. A change left running overnight (no "off" recorded)
 * is capped at the later of the workday end and an hour after it began, so
 * a forgotten tab does not count as hours of sitting.
 */
export function spans(
  sorted: ActivityEvent[],
  from: number,
  to: number,
  now: number,
  settings: Settings,
): Span[] {
  const out: Span[] = []
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]
    const start = time(e)
    const next = sorted[i + 1]
    let end = next ? time(next) : now
    const open = !next && dayKey(start) === dayKey(now)
    if (dayKey(end) !== dayKey(start) || (!next && !open)) {
      const cap = Math.max(atClock(start, settings.workdayEnd), start + HOUR)
      end = Math.min(end, cap, addDays(startOfDay(start), 1))
    }
    const s = Math.max(start, from)
    const t = Math.min(end, to)
    if (t > s && e.activity !== 'off') {
      out.push({
        eventId: e.id,
        activity: e.activity,
        source: e.source,
        start: s,
        end: t,
        open,
      })
    }
  }
  return out
}

export type Totals = Record<Activity, number>

export function emptyTotals(): Totals {
  return Object.fromEntries(ACTIVITIES.map((a) => [a, 0])) as Totals
}

/** Minutes per activity. */
export function totals(list: Span[]): Totals {
  const out = emptyTotals()
  for (const s of list) out[s.activity] += (s.end - s.start) / MINUTE
  return out
}

/** Longest stretch sitting or standing without switching, in minutes. */
export function longestStill(list: Span[]): number {
  let best = 0
  for (const s of list) {
    if (s.activity === 'sit' || s.activity === 'stand') {
      best = Math.max(best, (s.end - s.start) / MINUTE)
    }
  }
  return best
}

export interface DaySummary {
  day: string
  start: number
  totals: Totals
  longestStill: number
  tracked: number
}

export function daySummaries(
  sorted: ActivityEvent[],
  from: number,
  days: number,
  now: number,
  settings: Settings,
): DaySummary[] {
  const out: DaySummary[] = []
  for (let i = 0; i < days; i++) {
    const start = addDays(startOfDay(from), i)
    const list = spans(sorted, start, addDays(start, 1), now, settings)
    const t = totals(list)
    out.push({
      day: dayKey(start),
      start,
      totals: t,
      longestStill: longestStill(list),
      tracked: Object.values(t).reduce((a, b) => a + b, 0),
    })
  }
  return out
}
