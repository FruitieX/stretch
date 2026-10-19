import type { Activity, ActivityEvent, Source } from './model.ts'
import { time } from './timeline.ts'

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

/** What was going on at `t` ("off" = untracked). */
export function activityAt(marks: Mark[], t: number): Activity {
  let a: Activity = 'off'
  for (const m of marks) if (m.at <= t) a = m.activity
  return a
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

/** Timeline edits snap to five minutes, and no block gets shorter than that. */
export const SNAP = 5 * 60_000

/**
 * How far the change `id` (a block edge) can move: never past the
 * neighbouring changes, so resizing can't swallow a block, and never into
 * the future. `floor` bounds the first change of the day.
 */
export function edgeLimits(
  marks: Mark[],
  id: string,
  now: number,
  floor: number,
): { min: number; max: number } | null {
  const i = marks.findIndex((m) => m.id === id)
  if (i < 0) return null
  const prev = marks[i - 1]
  const next = marks[i + 1]
  return {
    min: Math.max(floor, prev ? prev.at + SNAP : floor),
    max: next ? Math.min(next.at - SNAP, now) : now,
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
  const at = Math.min(limits.max, Math.max(limits.min, to))
  return marks.map((m) => (m.id === id ? { ...m, at } : m))
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
