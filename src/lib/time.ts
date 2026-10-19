export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

const pad = (n: number, length = 2) => String(Math.abs(n)).padStart(length, '0')

/** RFC 3339 in local time with the UTC offset, e.g. 2026-10-19T09:02:00.000+03:00. */
export function isoLocal(ms: number): string {
  const d = new Date(ms)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  )
}

/** Local calendar day, "YYYY-MM-DD". */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** "HH:MM" on the local day containing `ms`. */
export function atClock(ms: number, clock: string): number {
  const [h, m] = clock.split(':').map(Number)
  const d = new Date(ms)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}

export function clock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "45 min", "1 h 05 min". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`
}

/** Compact "1h05" / "45m" for tight spaces. */
export function short(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${pad(m % 60)}`
}
