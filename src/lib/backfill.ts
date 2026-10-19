import type { Activity, ActivityEvent } from './model.ts'
import { time } from './timeline.ts'

/** One stretch of the recent past: doing `activity` from `start` until the next row. */
export interface Row {
  activity: Activity
  start: number
}

export interface Backfill {
  /** The current change, moved and/or relabelled. */
  update: { event: ActivityEvent; activity: Activity; at: number }
  /** Earlier changes to add, oldest first. */
  add: Row[]
  /** Recorded changes that the rows now cover. */
  remove: string[]
}

/**
 * Rewrites the recent past as "doing rows[0] since …, before that rows[1]
 * since …". `rows` runs newest first; rows[0] is the current activity.
 * Anything recorded between the earliest row and now is replaced.
 */
export function backfill(
  sorted: ActivityEvent[],
  current: ActivityEvent,
  rows: Row[],
  now: number,
): Backfill | { error: string } {
  if (!rows.length) return { error: 'Nothing to change.' }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].start > now) return { error: 'Times can’t be in the future.' }
    if (i > 0 && rows[i].start >= rows[i - 1].start) {
      return {
        error: 'Each earlier activity needs to start before the one after it.',
      }
    }
  }
  const earliest = rows[rows.length - 1].start
  const remove = sorted
    .filter((e) => e.id !== current.id && time(e) >= earliest && time(e) <= now)
    .map((e) => e.id)
  return {
    update: { event: current, activity: rows[0].activity, at: rows[0].start },
    add: rows.slice(1).reverse(),
    remove,
  }
}
