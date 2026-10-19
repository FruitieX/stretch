import type {
  Activity,
  ActivityEvent,
  Device,
  Posture,
  Settings,
  Status,
} from './model.ts'
import { DOING, isPosture, isStill } from './model.ts'
import { spans, time, totals, type Span, type Totals } from './timeline.ts'
import {
  MINUTE,
  addDays,
  atClock,
  dayKey,
  duration,
  startOfDay,
} from './time.ts'

/** How far ahead another device's change may be and still count as current. */
const CLOCK_SKEW = 2 * MINUTE

export interface Current {
  eventId: string
  activity: Activity
  source: ActivityEvent['source']
  /** The activity before this one today, if any. */
  previous: Activity | null
  since: number
  /** Minutes so far. */
  elapsed: number
}

export interface Suggestion {
  /** What to do next; `break` with `then` means "move briefly, then …". */
  activity: Activity
  then?: Posture
  dueAt: number
  due: boolean
  /** Snoozed with "Not now" at least once. */
  declines: number
  reason: string
}

export interface StillAlarm {
  /** 0 = not yet, 1 = first ping, 2+ = escalated. */
  level: number
  dueAt: number
  /** When the next escalation happens, if any. */
  nextAt: number | null
}

export interface Block {
  activity: Activity
  start: number
  end: number
}

export interface Plan {
  current: Current | null
  today: Span[]
  totals: Totals
  available: Posture[]
  suggestion: Suggestion | null
  still: StillAlarm | null
  preview: Block[]
  /** Past the workday end, paused, or done for the day. */
  quiet: boolean
  inCall: boolean
}

export function available(device: Device): Posture[] {
  return [
    'sit',
    ...(device.standingDesk ? (['stand'] as const) : []),
    ...(device.walkingPad ? (['walk'] as const) : []),
  ]
}

type Need = Record<'stand' | 'walk', number>

/** Picks the posture to suggest after `prev`. May return `prev` itself when nothing else is available. */
export function nextPosture(
  prev: Posture,
  need: Need,
  remaining: number,
  avail: Posture[],
): Posture {
  const can = (p: Posture) => p !== prev && avail.includes(p)
  if (prev === 'sit') {
    const options = (['stand', 'walk'] as const).filter(can)
    if (!options.length) return 'sit'
    // Whichever is furthest behind its target; standing wins ties.
    return options.reduce((best, p) => (need[p] > need[best] ? p : best))
  }
  if (prev === 'stand') return can('walk') ? 'walk' : 'sit'
  // After walking, stand instead of sitting when standing is far behind.
  if (can('stand') && need.stand > remaining * 0.4) return 'stand'
  return 'sit'
}

/** Going back down to sitting, or repeating a posture, gets a move break first. */
function withMoveBreak(
  prev: Posture,
  next: Posture,
): Pick<Suggestion, 'activity' | 'then'> {
  if (next === prev || (prev === 'stand' && next === 'sit'))
    return { activity: 'break', then: next }
  return { activity: next }
}

function reasonFor(
  current: Current,
  next: Pick<Suggestion, 'activity' | 'then'>,
): string {
  const doing = DOING[current.activity].toLowerCase()
  if (current.activity === 'break') return 'Break done.'
  const length = duration(current.elapsed)
  if (next.activity === 'break')
    return `${capitalize(doing)} for ${length}. Move around for a moment.`
  return `${capitalize(doing)} for ${length}.`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The posture before the current break, so the rotation continues. */
function postureBefore(
  sorted: ActivityEvent[],
  index: number,
  dayStart: number,
): Posture {
  for (let i = index - 1; i >= 0 && time(sorted[i]) >= dayStart; i--) {
    const a = sorted[i].activity
    if (isPosture(a)) return a
  }
  return 'sit'
}

export function plan(
  now: number,
  sorted: ActivityEvent[],
  settings: Settings,
  device: Device,
  status: Status,
): Plan {
  const dayStart = startOfDay(now)
  const today = spans(sorted, dayStart, addDays(dayStart, 1), now, settings)
  const sums = totals(today)
  const avail = available(device)
  const end = atClock(now, settings.workdayEnd)
  const inCall = (status.callUntil ?? 0) > now

  // The latest change counts as current only if it happened today. Changes
  // slightly in the future still count: another device's clock may run a
  // little ahead, and this one only ticks every few seconds.
  let index = -1
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (time(sorted[i]) <= now + CLOCK_SKEW) {
      index = i
      break
    }
  }
  const latest = index >= 0 ? sorted[index] : null
  const current: Current | null =
    latest && time(latest) >= dayStart && latest.activity !== 'off'
      ? {
          eventId: latest.id,
          activity: latest.activity,
          source: latest.source,
          previous:
            index > 0 && time(sorted[index - 1]) >= dayStart
              ? sorted[index - 1].activity
              : null,
          since: time(latest),
          elapsed: Math.max(0, now - time(latest)) / MINUTE,
        }
      : null

  const quiet = !current || now >= end || status.pausedDay === dayKey(now)
  const base: Plan = {
    current,
    today,
    totals: sums,
    available: avail,
    suggestion: null,
    still: null,
    preview: [],
    quiet,
    inCall,
  }
  if (!current || quiet) return base

  const snooze =
    status.snooze?.eventId === current.eventId ? status.snooze : undefined
  const remaining = (end - now) / MINUTE
  const need = (done: Totals): Need => ({
    stand: Math.max(0, settings.targets.stand - done.stand),
    walk: Math.max(0, settings.targets.walk - done.walk),
  })

  let suggestion: Suggestion | null = null
  if (isPosture(current.activity) || current.activity === 'break') {
    const prev = isPosture(current.activity)
      ? current.activity
      : postureBefore(sorted, index, dayStart)
    const nextP = nextPosture(prev, need(sums), remaining, avail)
    const next: Pick<Suggestion, 'activity' | 'then'> = isPosture(
      current.activity,
    )
      ? withMoveBreak(prev, nextP)
      : { activity: nextP }
    const length = isPosture(current.activity)
      ? settings.limits[current.activity]
      : settings.moveBreak
    const dueAt = Math.max(current.since + length * MINUTE, snooze?.until ?? 0)
    if (dueAt < end) {
      suggestion = {
        ...next,
        dueAt,
        due: now >= dueAt,
        declines: snooze?.declines ?? 0,
        reason: reasonFor(current, next),
      }
    }
  }

  let still: StillAlarm | null = null
  if (isStill(current.activity)) {
    const dueAt = Math.max(
      current.since + settings.stillLimit * MINUTE,
      snooze?.until ?? 0,
    )
    const steps = [0, ...settings.escalation].map((m) => dueAt + m * MINUTE)
    const level = steps.filter((t) => now >= t).length
    still = { level, dueAt, nextAt: steps.find((t) => t > now) ?? null }
  }

  return {
    ...base,
    suggestion,
    still,
    preview: preview(
      now,
      end,
      current,
      suggestion,
      sums,
      settings,
      avail,
      need,
    ),
  }
}

/** A tentative rest-of-day rotation; recomputed on every change. */
function preview(
  now: number,
  end: number,
  current: Current,
  suggestion: Suggestion | null,
  done: Totals,
  settings: Settings,
  avail: Posture[],
  need: (done: Totals) => Need,
): Block[] {
  if (!suggestion) return []
  const sums = { ...done }
  const blocks: Block[] = []
  let at = Math.max(now, suggestion.dueAt)
  blocks.push({ activity: current.activity, start: current.since, end: at })
  sums[current.activity] += (at - now) / MINUTE
  let activity: Activity = suggestion.activity
  let then = suggestion.then
  let prev: Posture = isPosture(current.activity)
    ? current.activity
    : (suggestion.then ?? 'sit')
  while (at < end && blocks.length < 40) {
    const length = isPosture(activity)
      ? settings.limits[activity]
      : settings.moveBreak
    const stop = Math.min(end, at + length * MINUTE)
    blocks.push({ activity, start: at, end: stop })
    sums[activity] += (stop - at) / MINUTE
    at = stop
    if (then) {
      activity = then
      then = undefined
      continue
    }
    if (isPosture(activity)) prev = activity
    const next = withMoveBreak(
      prev,
      nextPosture(prev, need(sums), (end - at) / MINUTE, avail),
    )
    activity = next.activity
    then = next.then
  }
  return blocks
}

/** Snooze length: 10 min, then 15, 20…; the stillness alarm at most 10 min. */
export function snoozeFor(
  p: Plan,
  status: Status,
  now: number,
): Status['snooze'] {
  if (!p.current) return undefined
  const prior =
    status.snooze?.eventId === p.current.eventId ? status.snooze.declines : 0
  const declines = prior + 1
  let minutes = 10 + 5 * (declines - 1)
  if (p.still && p.still.level > 0) minutes = Math.min(minutes, 10)
  return { eventId: p.current.eventId, until: now + minutes * MINUTE, declines }
}
