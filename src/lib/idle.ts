import type { Activity, Settings } from './model.ts'
import type { Current } from './planner.ts'
import { MINUTE, atClock } from './time.ts'

export interface Change {
  activity: Activity
  at: number
  source: 'idle' | 'auto'
}

/** Activities that idle time interrupts. Walking, eating and being away continue. */
const INTERRUPTED: Activity[] = ['sit', 'stand', 'break']

/**
 * The user went idle (or the machine slept) at `idleSince`. Records `away`
 * from that moment, or `off` when it happened after the workday end.
 */
export function onIdle(
  current: Current | null,
  idleSince: number,
  settings: Settings,
): Change | null {
  if (!current || !INTERRUPTED.includes(current.activity)) return null
  // Strictly after the interrupted change so the two always sort in order.
  const at = Math.max(idleSince, current.since + 1000)
  const end = atClock(at, settings.workdayEnd)
  return { activity: at >= end ? 'off' : 'away', at, source: 'idle' }
}

export interface Return {
  /** Change to record now: resume the previous activity, or end the day. */
  change: Change | null
  awayMinutes: number
  /** Offer "That was lunch" (long enough, around midday, no lunch yet). */
  lunch: boolean
}

/** The user is back after an automatic `away`. */
export function onReturn(
  current: Current | null,
  now: number,
  settings: Settings,
  eatenToday: boolean,
): Return | null {
  if (!current || current.activity !== 'away' || current.source !== 'idle')
    return null
  const awayMinutes = (now - current.since) / MINUTE
  const end = atClock(now, settings.workdayEnd)
  if (now >= end) {
    return {
      change: {
        activity: 'off',
        at: Math.max(current.since, end),
        source: 'auto',
      },
      awayMinutes,
      lunch: false,
    }
  }
  const previous = current.previous
  const resume: Activity =
    previous && INTERRUPTED.includes(previous) && previous !== 'break'
      ? previous
      : 'sit'
  const startedAt = new Date(current.since)
  const hour = startedAt.getHours() + startedAt.getMinutes() / 60
  return {
    change: { activity: resume, at: now, source: 'auto' },
    awayMinutes,
    lunch:
      !eatenToday &&
      awayMinutes >= settings.lunchPromptAfter &&
      hour >= 10.5 &&
      hour < 14.5,
  }
}

/** A tick arriving much later than scheduled means the machine slept. */
export const SLEEP_GAP = 2 * MINUTE
