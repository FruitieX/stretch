import type { Activity, ActivityEvent, Source } from './model.ts'
import { time } from './timeline.ts'
import { dayKey } from './time.ts'

/** An activity change in milliseconds; `id` is missing for new ones. */
export interface Mark {
  id?: string
  at: number
  activity: Activity
  source: Source
}

export const toMarks = (sorted: ActivityEvent[]): Mark[] =>
  sorted.map((e) => ({
    id: e.id,
    at: time(e),
    activity: e.activity,
    source: e.source,
  }))

/**
 * What was going on at `t` ("off" = untracked). Each day starts untracked:
 * yesterday's last activity doesn't carry over into this morning.
 */
export function activityAt(marks: Mark[], t: number): Activity {
  let last: Mark | undefined
  for (const m of marks) if (m.at <= t) last = m
  return last && dayKey(last.at) === dayKey(t) ? last.activity : 'off'
}

/** What was going on just before `t`. */
export function activityBefore(marks: Mark[], t: number): Activity {
  return activityAt(marks, t - 1)
}

const sort = (marks: Mark[]) => [...marks].sort((a, b) => a.at - b.at)

/** Drops changes in [from, to] that repeat the activity before them. */
function tidy(marks: Mark[], from: number, to: number): Mark[] {
  const out: Mark[] = []
  for (const m of marks) {
    const prev = out[out.length - 1]
    const inWindow = m.at >= from && m.at <= to
    const repeat = prev ? prev.activity === m.activity : m.activity === 'off'
    if (inWindow && repeat) continue
    out.push(m)
  }
  return out
}

/**
 * Sets [from, to) to `activity`, replacing whatever was recorded there. What
 * was going on at `to` resumes afterwards. Painting up to `now` makes it the
 * current activity. `reuseId` keeps an edited change's id.
 */
export function paint(
  marks: Mark[],
  from: number,
  to: number,
  activity: Activity,
  now: number,
  reuseId?: string,
): Mark[] {
  if (to <= from) return marks
  const open = to >= now
  const resume = activityAt(marks, to)
  const kept = marks.filter((m) => m.at < from || (!open && m.at >= to))
  const id =
    reuseId && !kept.some((m) => m.id === reuseId) ? reuseId : undefined
  const added: Mark[] = [{ id, at: from, activity, source: 'manual' }]
  if (!open && !kept.some((m) => m.at === to)) {
    added.push({ at: to, activity: resume, source: 'manual' })
  }
  return tidy(sort([...kept, ...added]), from, open ? Infinity : to)
}

export interface SpanRef {
  id: string
  start: number
  end: number
  /** The current activity; its end is "now". */
  open: boolean
}

/** Edits one block of the timeline; neighbours grow or shrink to fit. */
export function editSpan(
  marks: Mark[],
  span: SpanRef,
  activity: Activity,
  from: number,
  to: number,
  now: number,
): Mark[] {
  let m = marks
  const end = span.open ? now : span.end
  const newEnd = span.open ? now : Math.min(to, now)
  // Shrinking at either end hands that time back to the neighbour.
  if (!span.open && newEnd < end)
    m = paint(m, newEnd, end, activityAt(m, end), now)
  if (from > span.start) {
    m = paint(m, span.start, from, activityBefore(m, span.start), now)
  }
  return paint(m, from, newEnd, activity, now, span.id)
}

/** Removes a block; the activity before it continues instead. */
export function deleteSpan(marks: Mark[], span: SpanRef, now: number): Mark[] {
  const end = span.open ? now : span.end
  return paint(marks, span.start, end, activityBefore(marks, span.start), now)
}

export interface Ops {
  add: Mark[]
  update: Mark[]
  remove: string[]
}

/** The saves and deletes that turn `before` into `after`. */
export function diff(before: Mark[], after: Mark[]): Ops {
  const old = new Map(before.filter((m) => m.id).map((m) => [m.id!, m]))
  const ids = new Set(after.filter((m) => m.id).map((m) => m.id!))
  return {
    add: after.filter((m) => !m.id),
    update: after.filter((m) => {
      const o = m.id ? old.get(m.id) : undefined
      return o && (o.at !== m.at || o.activity !== m.activity)
    }),
    remove: [...old.keys()].filter((id) => !ids.has(id)),
  }
}

/**
 * Timeline edits snap to five minutes, and recorded blocks never get shorter
 * than that when a neighbour is dragged into them.
 */
export const SNAP = 5 * 60_000

/**
 * The time to use for a pointer at `t`: the nearest block edge within a few
 * minutes (so blocks can be lined up exactly), otherwise the 5-minute grid.
 */
export function snapTime(
  t: number,
  edges: number[],
  magnet = 3 * 60_000,
): number {
  let best: number | undefined
  for (const e of edges) {
    if (
      Math.abs(e - t) <= magnet &&
      (best === undefined || Math.abs(e - t) < Math.abs(best - t))
    ) {
      best = e
    }
  }
  return best ?? Math.round(t / SNAP) * SNAP
}

/** How short a block may get when a neighbour is dragged into it: untracked gaps can close entirely. */
const margin = (a: Activity) => (a === 'off' ? 0 : SNAP)

/** Removes blocks left with no length, then merges repeats, around [lo, hi]. */
function collapse(marks: Mark[], lo: number, hi: number): Mark[] {
  const sorted = sort(marks)
  const kept = sorted.filter(
    (m, j) => !(sorted[j + 1] && sorted[j + 1].at <= m.at),
  )
  return tidy(kept, lo, hi)
}

/**
 * How far the change `id` (a block edge) can move: neighbouring blocks keep
 * at least `SNAP` (untracked gaps may close), nothing moves into the future,
 * and `floor` bounds the first change of the day.
 */
export function edgeLimits(
  marks: Mark[],
  id: string,
  now: number,
  floor: number,
): { min: number; max: number } | null {
  const i = marks.findIndex((m) => m.id === id)
  if (i < 0) return null
  const edge = marks[i]
  const prev = marks[i - 1]
  const next = marks[i + 1]
  const sameDay = prev && dayKey(prev.at) === dayKey(edge.at)
  return {
    min: sameDay ? Math.max(floor, prev.at + margin(prev.activity)) : floor,
    max: next ? Math.min(next.at - margin(edge.activity), now) : now,
  }
}

/** Moves a block edge (the change `id`), clamped to `edgeLimits`. */
export function moveEdge(
  marks: Mark[],
  id: string,
  to: number,
  now: number,
  floor: number,
): Mark[] {
  const limits = edgeLimits(marks, id, now, floor)
  if (!limits || limits.min > limits.max) return marks
  const old = marks.find((m) => m.id === id)!.at
  const at = Math.min(limits.max, Math.max(limits.min, to))
  return collapse(
    marks.map((m) => (m.id === id ? { ...m, at } : m)),
    Math.min(old, at, limits.min),
    Math.max(old, at, limits.max),
  )
}

/**
 * Recorded blocks a range edit would wipe out entirely, for a warning.
 * Blocks that are only trimmed (some of them survives) are not listed.
 */
export function replaced(before: Mark[], after: Mark[], now: number): Mark[] {
  const removed = new Set(diff(before, after).remove)
  return before.filter((m, i) => {
    if (!m.id || !removed.has(m.id) || m.activity === 'off') return false
    const end = before[i + 1]?.at ?? now
    for (let t = m.at; t < end; t += SNAP) {
      if (activityAt(after, t) === m.activity) return false
    }
    return activityAt(after, end - 1) !== m.activity
  })
}

/**
 * How far the block starting at change `id` can slide (in ms, negative =
 * earlier). Its end edge moves with it unless it is the current activity;
 * recorded neighbours keep at least `SNAP`, untracked gaps may close, and
 * nothing moves past `now`.
 */
export function slideLimits(
  marks: Mark[],
  id: string,
  now: number,
  floor: number,
): { min: number; max: number } | null {
  const i = marks.findIndex((m) => m.id === id)
  if (i < 0) return null
  const block = marks[i]
  const prev = marks[i - 1]
  const end = marks[i + 1]
  const after = marks[i + 2]
  const sameDay = prev && dayKey(prev.at) === dayKey(block.at)
  const min =
    (sameDay ? Math.max(floor, prev.at + margin(prev.activity)) : floor) -
    block.at
  const max = end
    ? Math.min(
        after ? after.at - margin(end.activity) : now - margin(end.activity),
        now,
      ) - end.at
    : now - SNAP - block.at
  return { min: Math.min(0, min), max: Math.max(0, max) }
}

/** Slides a block by `delta` ms, clamped to `slideLimits`. */
export function slideBlock(
  marks: Mark[],
  id: string,
  delta: number,
  now: number,
  floor: number,
): Mark[] {
  const limits = slideLimits(marks, id, now, floor)
  if (!limits) return marks
  const d = Math.min(limits.max, Math.max(limits.min, delta))
  const i = marks.findIndex((m) => m.id === id)
  const lo = (marks[i - 1]?.at ?? marks[i].at) - 1
  const hi = (marks[i + 2]?.at ?? now) + 1
  return collapse(
    marks.map((m, j) => (j === i || j === i + 1 ? { ...m, at: m.at + d } : m)),
    lo,
    hi,
  )
}

/** A switch this soon after the previous one corrects it instead. */
export const QUICK_SWITCH = 60_000

/**
 * Switches to `activity` now. Within `QUICK_SWITCH` of the latest change,
 * that change is relabelled (keeping its start) rather than leaving a
 * sub-minute block behind; switching straight back to the activity before
 * it drops the brief change altogether.
 */
export function switchTo(
  marks: Mark[],
  activity: Activity,
  now: number,
): Mark[] {
  // The latest change, allowing for another device's clock running ahead.
  let i = -1
  marks.forEach((m, j) => {
    if (m.at <= now + QUICK_SWITCH) i = j
  })
  const last = marks[i]
  const recent =
    last?.id && now - last.at < QUICK_SWITCH && dayKey(last.at) === dayKey(now)
  if (!recent) return [...marks, { at: now, activity, source: 'manual' }]
  if (last.activity === activity) return marks
  const prev = marks[i - 1]
  if (prev && prev.activity === activity && dayKey(prev.at) === dayKey(now)) {
    return marks.filter((_, j) => j !== i)
  }
  return marks.map((m, j) =>
    j === i ? { ...m, activity, source: 'manual' } : m,
  )
}
